import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, cpSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import type { IBuildStorageProvider, OpenedOutput } from "../../../build-system-core/build-storage-provider.js";
import type { BuildOptions } from "../../../build-system-core/build-options.js";
import { ProjectBuildStatus } from "../../../build-system-core/build-result.js";
import { TodlBuildSystemRegistry } from "../../todl-build-system-registry.js";
import { HtmlBundleBuildSystem } from "../html-bundle-build-system.js";
import { EmitBundledHostAction } from "../emit-bundled-host-action.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import { parseManifest, ProjectType } from "../../../package-manager/manifest.js";
import { LocalNpmRegistry } from "../../../package-manager/registries/npm/local-npm-registry.js";
import { PackageRegistryClient } from "../../../package-manager/package-registry-client.js";
import { SolutionBuildManager, type SolutionProject } from "../../solution/solution-build-manager.js";
import { RegistrySource } from "../../registry-source.js";
import type { IPackageSource } from "../../package-source.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { compilePackage, type CompiledPackage } from "../../../../publish/publish.js";
import { GeneratorTrigger, type GeneratorContext } from "../../../project-services/generators/project-content-generator.js";
import { ProjectModelProvider } from "../../../project-services/generators/project-model-provider.js";
import { DtoGenerator } from "../../../project-services/generators/dto-generator.js";
import { UiPlaceholderGenerator } from "../../../project-services/generators/ui-placeholder-generator.js";

// A sentinel standing in for a real esbuild-produced bundle (BundleAppAction's output) —
// distinctive enough that its presence in the emitted page proves the ACTUAL AppBundle
// artifact was inlined, not a coincidental match.
const SentinelBundle = "/*BUNDLE*/(()=>{})();";

function contextWith(): TodlBuildContext
{
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: new BuildArtifacts(),
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

function compiledModelFixture(): CompiledPackage
{
    const outcome = compilePackage([], [{ uri: "model.todl", text:
        `namespace acme { concept App { label : string?; } model M : acme { App a1 { label = "A1"; } } }` }],
        { id: "my-arch", version: "0.1.0" });
    assert.ok(outcome.ok && outcome.package, JSON.stringify(outcome.diagnostics));
    return outcome.package!;
}

describe("HtmlBundleBuildSystem", () =>
{
    test("applies to architecture projects only", () =>
    {
        const system = new HtmlBundleBuildSystem();
        assert.equal(system.AppliesTo({ type: "architecture", name: "a", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "meta-model", name: "m", version: 1 } as never), false);
        assert.equal(system.AppliesTo({ type: "library", name: "l", version: 1 } as never), false);
    });

    test("the registry offers html-bundle for architecture, not for meta-model", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        assert.equal(registry.For({ type: ProjectType.Architecture, name: "a" } as never).some((s) => s.Id === "html-bundle"), true);
        assert.equal(registry.For({ type: ProjectType.MetaModel, name: "m" } as never).some((s) => s.Id === "html-bundle"), false);
    });
});

describe("EmitBundledHostAction", () =>
{
    test("emits a self-contained index.html with the compiled model payload and the compiled app bundle inlined", async () =>
    {
        const ctx = contextWith();
        const compiled = compiledModelFixture();
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, compiled);
        ctx.Artifacts.Set(HtmlArtifacts.AppBundle, SentinelBundle);

        await new EmitBundledHostAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const html = await ctx.Sandbox.ReadText("index.html");
        assert.ok(html.includes(`window.__TODL_APP__ = ${JSON.stringify(compiled.fullDocument)};`),
            "the compiled model's full document is inlined as the app payload");
        assert.ok(html.includes(SentinelBundle), "the compiled app bundle is inlined");
        assert.ok(!html.includes("MuralAppBundle"), "no longer references the retired frozen MuralAppBundle");
    });

    test("no AppBundle artifact reports a Severity.Error diagnostic and writes no index.html", async () =>
    {
        const ctx = contextWith();
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, compiledModelFixture());

        await assert.doesNotReject(() => new EmitBundledHostAction().Execute(ctx));

        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error));
        assert.equal(await ctx.Sandbox.Exists("index.html"), false);
    });

    test("no CompiledModel artifact reports a Severity.Error diagnostic and writes no index.html", async () =>
    {
        const ctx = contextWith();
        ctx.Artifacts.Set(HtmlArtifacts.AppBundle, SentinelBundle);

        await assert.doesNotReject(() => new EmitBundledHostAction().Execute(ctx));

        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error));
        assert.equal(await ctx.Sandbox.Exists("index.html"), false);
    });
});

// END-TO-END — builds the REAL fixture project (TODL/test_projects/architectures/
// test_architecture) through the full new pipeline: resolve bases -> compile model ->
// generate DTO/app UI/entry -> real mural compile -> real esbuild bundle -> emit
// index.html. Drives the same solution-manager stack as the user-smoke-test (build the
// bases as npm packages, publish to a local registry, then build the architecture as
// html-bundle resolving those bases from the registry), minus the browser-render check —
// this is a build-correctness test, not a rendering one. Slow (real compiles + esbuild);
// that is expected.
const FixtureHere = dirname(fileURLToPath(import.meta.url));
const FixtureRoot = join(FixtureHere, "../../../../../test_projects");
const MetaModelFixture = "meta-models/tech-architecture";
const MicrosoftLibraryFixture = "libraries/microsoft";
const AwsLibraryFixture = "libraries/aws";
const ArchitectureFixture = "architectures/test_architecture";

// The paths/generator ids html-bundle now REQUIRES (Task 11) instead of creating —
// mirrors HtmlBundleBuildSystem.RequiredContent, so a fail-fast diagnostic's message is
// asserted against the same identifiers the flavor declares.
const ModelDtoPath = "generated/model.ts";
const ModelDtoGeneratorId = "model-dto";
const AppUiPath = "generated/app.mu";
const AppUiGeneratorId = "app-ui";
const GeneratedDirectory = "generated";

// Runs the two project content generators (Tasks 3-4) that now own the html-bundle
// flavor's required content, against the same compile seam (ProjectModelProvider) and
// package source the architecture resolves its bases with. Stands in for whatever
// scheduled the generators outside of this test (project creation / references-changed).
async function generateRequiredContent(architecture: SolutionProject, source: IPackageSource): Promise<void>
{
    const model = new ProjectModelProvider(architecture.Project, architecture.Manifest, source);
    const diagnostics = new DiagnosticSink();
    const ctx: GeneratorContext = {
        Project: architecture.Project,
        Manifest: architecture.Manifest,
        Model: model,
        Diagnostics: diagnostics,
        Reason: GeneratorTrigger.OnDemand,
    };
    await new DtoGenerator().Generate(ctx);
    await new UiPlaceholderGenerator().Generate(ctx);
    assert.equal(diagnostics.Count, 0, JSON.stringify(diagnostics.All()));
}

// Lists the files under a project-relative directory (sorted, depth-first), so a test
// can capture a before/after snapshot and assert the build left it untouched.
async function filesUnder(storage: IStorage, dir: string): Promise<readonly string[]>
{
    if (!(await storage.Exists(dir))) return [];
    const files: string[] = [];
    await collectFiles(storage, dir, files);
    return files.sort();
}

async function collectFiles(storage: IStorage, dir: string, into: string[]): Promise<void>
{
    for (const entry of await storage.List(dir))
    {
        const path = `${dir}/${entry.Name}`;
        if (entry.IsDirectory) await collectFiles(storage, path, into);
        else into.push(path);
    }
}

function readOnlyFixture(rel: string): SolutionProject
{
    const manifest = parseManifest(readFileSync(join(FixtureRoot, rel, "project.plexus"), "utf8"));
    return { Id: manifest.id ?? manifest.name, Project: new NodeFsStorage(join(FixtureRoot, rel)), Manifest: manifest };
}

// Copies the architecture fixture into a scratch dir so a test's generated/* writes
// (the content generators write into the copy's Project; EmitEntryAction writes its
// build glue into ctx.Sandbox) never touch the real checked-in fixture. Strips any
// generated/ the copy inherited from the checked-in fixture (gitignored local build
// leftovers, not fixture content) so every test starts from a clean, deterministic
// "required content absent" state and opts into generating it explicitly.
async function copiedArchitectureFixture(t: TestContext): Promise<SolutionProject>
{
    const scratch = await mkdtemp(join(tmpdir(), "todl-e2e-arch-"));
    t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
    cpSync(join(FixtureRoot, ArchitectureFixture), scratch, { recursive: true });
    rmSync(join(scratch, GeneratedDirectory), { recursive: true, force: true });
    const manifest = parseManifest(readFileSync(join(scratch, "project.plexus"), "utf8"));
    return { Id: manifest.id ?? manifest.name, Project: new NodeFsStorage(scratch), Manifest: manifest };
}

// Real on-disk sandboxes + outputs under one scratch root, cleaned up after the test.
class ScratchBuildStorage implements IBuildStorageProvider
{
    private readonly outputs = new Map<string, string>();
    private counter = 0;

    constructor(private readonly root: string) {}

    public async CreateSandbox(): Promise<IStorage>
    {
        const storage = new NodeFsStorage(join(this.root, `sandbox-${this.counter++}`));
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
        let dir = this.outputs.get(key);
        if (dir === undefined)
        {
            dir = join(this.root, "output", key);
            await new NodeFsStorage(dir).CreateDirectory("");
            this.outputs.set(key, dir);
        }
        return { Storage: new NodeFsStorage(dir), Path: dir };
    }
}

// Phase 1 shared by the tests below that actually run the pipeline: builds the bases
// (meta-model + libraries) as npm packages and publishes them to a fresh local
// registry, so an architecture built against it can resolve them.
async function buildAndPublishBases(t: TestContext): Promise<{ solution: SolutionBuildManager; registry: LocalNpmRegistry }>
{
    const scratchRoot = await mkdtemp(join(tmpdir(), "todl-e2e-"));
    t.after(async () => { await rm(scratchRoot, { recursive: true, force: true }); });

    const provider = new ScratchBuildStorage(scratchRoot);
    const registry = new LocalNpmRegistry(new FakeStorage());
    const client = new PackageRegistryClient(registry);
    const solution = new SolutionBuildManager(new TodlBuildSystemRegistry(), provider);

    const meta = readOnlyFixture(MetaModelFixture);
    const microsoft = readOnlyFixture(MicrosoftLibraryFixture);
    const aws = readOnlyFixture(AwsLibraryFixture);
    const bases = await solution.Build({
        Projects: [microsoft, aws, meta],
        BuildSystemId: "npm-package",
        ExternalSource: new EmptyPackageSource(),
    });
    assert.equal(bases.Ok, true, JSON.stringify(bases.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));
    for (const outcome of bases.Projects) await client.publish(outcome.Result!.OutputPath!);

    return { solution, registry };
}

describe("end-to-end: real test_architecture fixture through the new html-bundle pipeline", () =>
{
    // Success path (Task 11 item 1): the flavor no longer generates generated/model.ts
    // /generated/app.mu itself — they are generated up front here, via the same
    // generators (DtoGenerator/UiPlaceholderGenerator) and compile seam
    // (ProjectModelProvider) a real caller would run before ever invoking this build,
    // against the same RegistrySource the architecture resolves its bases with.
    test("builds a self-contained index.html carrying the model payload and a real compiled bundle", async (t) =>
    {
        const { solution, registry } = await buildAndPublishBases(t);

        const architecture = await copiedArchitectureFixture(t);
        await generateRequiredContent(architecture, new RegistrySource(registry));

        const bundle = await solution.Build({
            Projects: [architecture],
            BuildSystemId: "html-bundle",
            ExternalSource: new RegistrySource(registry),
        });
        assert.equal(bundle.Ok, true, JSON.stringify(bundle.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));

        const built = bundle.Projects.find((p) => p.ProjectId === architecture.Id)!;
        assert.equal(built.Status, ProjectBuildStatus.Built);
        assert.ok(built.Result!.Artifacts.includes("index.html"), "produced index.html");

        const html = readFileSync(join(built.Result!.OutputPath!, "index.html"), "utf8");
        assert.ok(html.length > 0, "index.html is non-empty");
        assert.ok(html.includes("window.__TODL_APP__ ="), "the model payload is inlined");
        assert.ok(!html.includes("MuralAppBundle"), "no longer references the retired frozen MuralAppBundle");

        // Evidence the inlined script is a REAL esbuild bundle, not a sentinel/placeholder:
        // esbuild's IIFE wrapper plus the entry's own bootstrap call, both only present once
        // the whole chain (generate -> compile mural -> bundle) actually ran end-to-end.
        assert.match(html, /\(\(\)\s*=>\s*\{/, "esbuild's IIFE wrapper is present");
        assert.ok(html.includes("TodlAppBootstrap"), "the generated entry's bootstrap call was bundled in");
    });

    // Review Focus (Task 11 item 2): with neither required file generated, the build
    // must fail BEFORE any action runs — no bases to resolve, no registry needed — with
    // diagnostics naming each missing path and the generator that produces it, mirroring
    // ProjectBuildManager's Requires precondition (build-system-core's own coverage).
    test("a build with neither required file generated fails fast with diagnostics naming each path and its generator", async (t) =>
    {
        const scratchRoot = await mkdtemp(join(tmpdir(), "todl-e2e-missing-"));
        t.after(async () => { await rm(scratchRoot, { recursive: true, force: true }); });
        const provider = new ScratchBuildStorage(scratchRoot);
        const solution = new SolutionBuildManager(new TodlBuildSystemRegistry(), provider);

        const architecture = await copiedArchitectureFixture(t);
        const result = await solution.Build({
            Projects: [architecture],
            BuildSystemId: "html-bundle",
            ExternalSource: new EmptyPackageSource(),
        });

        assert.equal(result.Ok, false);
        const built = result.Projects.find((p) => p.ProjectId === architecture.Id)!;
        const messages = (built.Result?.Diagnostics ?? []).map((d) => d.message);
        assert.ok(
            messages.some((m) => m.includes(ModelDtoPath) && m.includes(ModelDtoGeneratorId)),
            `expected a diagnostic naming ${ModelDtoPath} + ${ModelDtoGeneratorId}, got ${JSON.stringify(messages)}`,
        );
        assert.ok(
            messages.some((m) => m.includes(AppUiPath) && m.includes(AppUiGeneratorId)),
            `expected a diagnostic naming ${AppUiPath} + ${AppUiGeneratorId}, got ${JSON.stringify(messages)}`,
        );
    });

    // Review Focus (Task 11 item 3): the build must never create or modify anything
    // under the project's generated/ — that boundary now belongs entirely to the
    // generators. Deliberately does NOT assert Ok: this must hold even when the build
    // fails downstream (e.g. the pre-existing esbuild node:fs/node:path resolution gap),
    // since no action in the pipeline writes to ctx.Project regardless of outcome.
    test("a build never creates or modifies anything under the project's generated/", async (t) =>
    {
        const { solution, registry } = await buildAndPublishBases(t);

        const architecture = await copiedArchitectureFixture(t);
        await generateRequiredContent(architecture, new RegistrySource(registry));
        const before = await filesUnder(architecture.Project, GeneratedDirectory);

        await solution.Build({
            Projects: [architecture],
            BuildSystemId: "html-bundle",
            ExternalSource: new RegistrySource(registry),
        });

        const after = await filesUnder(architecture.Project, GeneratedDirectory);
        assert.deepEqual(after, before, "the build must not create or modify anything under the project's generated/");
    });
});
