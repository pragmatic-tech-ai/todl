import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import {
    ProjectBuildStatus,
    type IBuildStorageProvider,
    type OpenedOutput,
    type BuildOptions,
} from "../src/solution-services/build-system-core/index.js";
import {
    SolutionBuildManager,
    TodlBuildSystemRegistry,
    RegistrySource,
    type SolutionProject,
    type IPackageSource,
    type SourcedPackage,
} from "../src/solution-services/todl-build-system/index.js";
import { PackageRegistryClient, parseManifest } from "../src/solution-services/package-manager/index.js";
import { LocalNpmRegistry } from "../src/solution-services/package-manager/registries/npm/local-npm-registry.js";
import type { PackageRef } from "../src/publish/publish.js";

// USER SMOKE TEST — builds the real on-disk architecture project (TODL/test_projects/
// architectures/test_architecture) into a single-page HTML application by driving the
// full solution-manager build stack: TodlBuildSystemRegistry (npm-package + html-bundle),
// SolutionBuildManager (dependency-ordered multi-project build), an in-memory package
// store (LocalNpmRegistry) for the bases, and cross-project base resolution through a
// RegistrySource. Because html-bundle is architecture-only, the bases (meta-model + two
// libraries) are built and published as npm packages first, then the architecture is
// built as an html-bundle resolving those bases from the registry.

const HERE = dirname(fileURLToPath(import.meta.url));
const TEST_PROJECTS = join(HERE, "../test_projects");
const META_MODEL = "meta-models/tech-architecture";
const MICROSOFT = "libraries/microsoft";
const AWS = "libraries/aws";
const ARCHITECTURE = "architectures/test_architecture";

function fsProject(rel: string): SolutionProject
{
    const manifest = parseManifest(readFileSync(join(TEST_PROJECTS, rel, "project.plexus"), "utf8"));
    return { Id: manifest.id ?? manifest.name, Project: new NodeFsStorage(join(TEST_PROJECTS, rel)), Manifest: manifest };
}

// A stable, filename-safe timestamp for the run directory: 2026-09-22T14-30-05.
function runStamp(): string
{
    return new Date().toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

// The persisted run directory: user-smoke-tests/<run_date_time>/. Its output/ subtree
// (where OpenOutput writes) is KEPT so the built HTML app can be opened afterwards.
function runDir(): string
{
    return join(HERE, runStamp());
}

// Scratch sandbox root — real temp dir, cleaned up after the run so only results persist.
async function sandboxRoot(t: TestContext): Promise<string>
{
    const root = await mkdtemp(join(tmpdir(), "todl-smoke-"));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    return root;
}

// Resolves nothing, so the bases can only come from the registry / accumulating output.
class EmptySource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

// Backs sandboxes and outputs with real filesystem dirs. Sandboxes go under a
// throwaway temp root; outputs go under <runDir>/output, keyed per project
// (OutputRootOverride), and are KEPT so the manager reads a built model.json back and
// the produced index.html survives for inspection.
class TempBuildStorage implements IBuildStorageProvider
{
    private readonly outputs = new Map<string, string>();
    private counter = 0;

    constructor(private readonly outputRoot: string, private readonly sandboxRoot: string) {}

    public async CreateSandbox(): Promise<IStorage>
    {
        const storage = new NodeFsStorage(join(this.sandboxRoot, `sandbox-${this.counter++}`));
        await storage.CreateDirectory("");
        return storage;
    }

    public async DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        await sandbox.Delete("");
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const key = `${options.OutputRootOverride ?? "main"}--${outputName}`;
        const dir = join(this.outputRoot, "output", key);
        if (!this.outputs.has(key))
        {
            await new NodeFsStorage(dir).CreateDirectory("");
            this.outputs.set(key, dir);
        }
        return { Storage: new NodeFsStorage(dir), Path: dir };
    }
}

// Pull the inlined shard payload out of the generated page and union every shard's
// node namespaces, to prove the full closure (meta-model + libraries) is carried.
function inlinedNamespaces(html: string): Set<string>
{
    const match = /window\.__TODL_APP__ = (.+);<\/script>/.exec(html);
    assert.notEqual(match, null, "the page inlines window.__TODL_APP__");
    const payload = JSON.parse(match![1]!) as { shards: Record<string, { nodes: { namespace?: string }[] }> };
    const namespaces = new Set<string>();
    for (const shard of Object.values(payload.shards))
    {
        for (const node of shard.nodes) if (node.namespace) namespaces.add(node.namespace);
    }
    return namespaces;
}

describe("user smoke: build test_architecture into a bundled application", () =>
{
    test("full solution-manager stack produces a self-contained HTML app carrying the meta-model + libraries", async (t) =>
    {
        const output = runDir();
        const provider = new TempBuildStorage(output, await sandboxRoot(t));
        const registry = new LocalNpmRegistry(new FakeStorage());
        const client = new PackageRegistryClient(registry);
        const solution = new SolutionBuildManager(new TodlBuildSystemRegistry(), provider);

        // Phase 1 — build the bases (meta-model + libraries) as npm packages in dependency
        // order, then publish each to the in-memory registry. Libraries are listed before
        // the meta-model to prove the manager reorders; the external source is empty, so the
        // libraries resolve their base only from the meta-model's just-built output.
        const meta = fsProject(META_MODEL);
        const microsoft = fsProject(MICROSOFT);
        const aws = fsProject(AWS);
        const bases = await solution.Build({
            Projects: [microsoft, aws, meta],
            BuildSystemId: "npm-package",
            ExternalSource: new EmptySource(),
        });
        assert.equal(bases.Ok, true, JSON.stringify(bases.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));
        for (const outcome of bases.Projects) await client.publish(outcome.Result!.OutputPath!);

        // Phase 2 — build the architecture as an html-bundle, resolving its meta-model +
        // libraries from the registry (html-bundle is architecture-only, so it is the only
        // project the manager builds here).
        const architecture = fsProject(ARCHITECTURE);
        const bundle = await solution.Build({
            Projects: [architecture],
            BuildSystemId: "html-bundle",
            ExternalSource: new RegistrySource(registry),
        });
        assert.equal(bundle.Ok, true, JSON.stringify(bundle.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));

        const built = bundle.Projects.find((p) => p.ProjectId === architecture.Id)!;
        assert.equal(built.Status, ProjectBuildStatus.Built);
        assert.ok(built.Result!.Artifacts.includes("index.html"), "produced index.html");

        // The page is a self-contained app: mount point + inlined shard payload + app bundle.
        const html = readFileSync(join(built.Result!.OutputPath!, "index.html"), "utf8");
        assert.match(html, /id="todl-app-root"/);
        assert.match(html, /__TODL_APP__/);
        assert.match(html, /MuralBundledHost/); // the mural host app bundle is inlined

        // The shard payload carries the whole closure — the meta-model AND both libraries — not
        // just the architecture's own instances.
        const namespaces = inlinedNamespaces(html);
        assert.ok(namespaces.has("tech_architecture"), "meta-model namespace bundled");
        assert.ok(namespaces.has("libraries.microsoft"), "microsoft library bundled");
        assert.ok(namespaces.has("libraries.aws"), "aws library bundled");

        // The inlined bundle must reflect the NEW themed .mu view, not the old imperative view.
        // These assertions fail if the bundle artifact is stale (regenerated before the theme fix).
        assert.match(html, /ModelBrowserResources/, "themed .mu resource dictionary must be bundled");
        assert.ok(!/ModelBrowserView/.test(html), "old imperative view must not be bundled");

        // REAL-BROWSER render check (requires `npx playwright install chromium`). The build
        // assertions above prove the page is well-formed, but not that it renders — a themed
        // Border rect passes a "non-empty SVG" check while every row is missing. Load the built
        // page in headless Chromium and assert the model-browser list actually paints: no page
        // errors, and many <text> nodes including known concept headers (the ItemsControl stamps
        // one row per instance — regression guard for the missing-ItemsPanel blank page).
        const indexHtml = join(built.Result!.OutputPath!, "index.html");
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        try
        {
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.goto(pathToFileURL(indexHtml).href, { waitUntil: "load" });
            await page.waitForTimeout(1500);   // let the RafClock paint a few frames
            const render = await page.evaluate(() =>
            {
                const texts = [...document.querySelectorAll("text")]
                    .map((t) => (t.textContent ?? "").trim())
                    .filter((s) => s.length > 0);
                return { textCount: texts.length, texts };
            });
            await page.screenshot({ path: join(built.Result!.OutputPath!, "render.png") });

            assert.deepEqual(errors, [], `browser page errors: ${errors.join("; ")}`);
            assert.ok(render.textCount >= 20, `expected the rendered list to paint many text nodes, got ${render.textCount}`);
            const headers = ["actor", "application", "component", "block"];
            assert.ok(
                render.texts.some((s) => headers.includes(s)),
                `expected a known concept header (${headers.join("/")}) in ${JSON.stringify(render.texts.slice(0, 30))}`,
            );
        }
        finally
        {
            await browser.close();
        }

        t.diagnostic(`run output kept at ${built.Result!.OutputPath!}`);
        t.diagnostic(`open the app: ${indexHtml}`);
        t.diagnostic(`render screenshot: ${join(built.Result!.OutputPath!, "render.png")}`);
    });
});
