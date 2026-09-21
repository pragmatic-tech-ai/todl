import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage, type IStorage, type StorageEntry } from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import {
    BuildSystemRegistry,
    ProjectBuildStatus,
    type IBuildAction,
    type ProjectBuildOutput,
    type IBuildStorageProvider,
    type OpenedOutput,
    type BuildOptions,
} from "../../../build-system-core/index.js";
import {
    TodlProjectBuildManager,
    SolutionBuildManager,
    NpmPackageBuildSystem,
    GeneratePresentationAction,
    RegistrySource,
    type TodlBuildContext,
    type IPackageSource,
    type SourcedPackage,
} from "../../../todl-build-system/index.js";
import { PackageRegistryClient, parseManifest, type ProjectManifest } from "../../../package-manager/index.js";
import { LocalNpmRegistry } from "../../../package-manager/registries/npm/local-npm-registry.js";
import { PackageKind, type PackageRef } from "../../../../publish/publish.js";
import type { TodlDocument } from "../../../../compiler-services/emit/json.js";
import type { IPresentationBaker, BakeOptions, BakeResult } from "../../../project-services/core/presentation-baker.js";

// End-to-end build-capability tests over the REAL on-disk projects under
// TODL/test_projects (a meta-model + two libraries), exercising the whole build-services
// machinery a shell drives: ProjectBuildManager + NpmPackageBuildSystem, presentation
// generation, publishing to an in-memory registry (LocalNpmRegistry over FakeStorage),
// cross-project base resolution through RegistrySource, and dependency-ordered solution
// builds through SolutionBuildManager. Builds run over real filesystem temp dirs (promote
// is a filesystem copy), the way the factory/integration tests do.

const TEST_PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../../../test_projects");
const META_MODEL = "meta-models/tech-architecture";
const MICROSOFT = "libraries/microsoft";
const AWS = "libraries/aws";
const LIBRARY_BAKE: BakeOptions = { dictName: "LibraryPresentation", iconPrefix: "" };

interface FixtureProject
{
    Id: string;
    Project: IStorage;
    Manifest: ProjectManifest;
}

function fsProject(rel: string, project: IStorage = new NodeFsStorage(join(TEST_PROJECTS, rel))): FixtureProject
{
    const manifest = parseManifest(readFileSync(join(TEST_PROJECTS, rel, "project.plexus"), "utf8"));
    return { Id: manifest.id ?? manifest.name, Project: project, Manifest: manifest };
}

async function tempRoot(t: TestContext): Promise<string>
{
    const root = await mkdtemp(join(tmpdir(), "todl-build-life-"));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    return root;
}

// A build source that resolves nothing, so a project's bases can only come from wherever
// the test wires them (the registry, or — in a solution build — the accumulating output).
class EmptySource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

// A storage that reports one path as absent (delegating everything else), to drive the
// presentation baker's missing-icon failure without mutating the real fixture.
class HidingStorage implements IStorage
{
    public readonly Root: string;

    constructor(private readonly inner: IStorage, private readonly hidden: string)
    {
        this.Root = inner.Root;
    }

    public Exists(path: string): Promise<boolean>
    {
        return path === this.hidden ? Promise.resolve(false) : this.inner.Exists(path);
    }

    public ReadText(path: string): Promise<string> { return this.inner.ReadText(path); }
    public ReadBytes(path: string): Promise<Uint8Array> { return this.inner.ReadBytes(path); }
    public WriteText(path: string, content: string): Promise<void> { return this.inner.WriteText(path, content); }
    public WriteBytes(path: string, bytes: Uint8Array): Promise<void> { return this.inner.WriteBytes(path, bytes); }
    public Delete(path: string): Promise<void> { return this.inner.Delete(path); }
    public CreateDirectory(path: string): Promise<void> { return this.inner.CreateDirectory(path); }
    public Rename(from: string, to: string): Promise<void> { return this.inner.Rename(from, to); }
    public List(path: string): Promise<readonly StorageEntry[]> { return this.inner.List(path); }
}

// A presentation baker double faithful to the real contract: it reads each icon path the
// compiled document declares, fails (missing) if the project lacks the file, and otherwise
// writes presentation.compiled.json + icon-index.json into the output. No mural coupling,
// so it runs headless in a test while still exercising GeneratePresentationAction (stamping
// + the missing-icon failure channel + the produced presentation files).
class TestPresentationBaker implements IPresentationBaker
{
    private static readonly PresentationDir = "presentation";

    public async Bake(project: IStorage, dest: IStorage, base: string, doc: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        const icons = TestPresentationBaker.IconPaths(doc);
        const missing: string[] = [];
        for (const path of icons) if (!(await project.Exists(path))) missing.push(path);
        if (missing.length > 0) return { ok: false, missing };

        const prefix = base.length > 0 ? `${base}/` : "";
        await dest.WriteText(`${prefix}${TestPresentationBaker.PresentationDir}/presentation.compiled.json`, JSON.stringify({ dict: options.dictName, icons }));
        await dest.WriteText(`${prefix}${TestPresentationBaker.PresentationDir}/icon-index.json`, JSON.stringify(icons));
        return { ok: true, icons: icons.length };
    }

    private static IconPaths(doc: TodlDocument): readonly string[]
    {
        const paths: string[] = [];
        for (const node of doc.nodes)
        {
            if (node.type !== "icon") continue;
            const path = (node.attrs as Record<string, unknown>)["path"];
            if (typeof path === "string" && path.length > 0) paths.push(path);
        }
        return paths;
    }
}

// A provider backing sandboxes + outputs with real filesystem temp dirs, keyed per project
// (OutputRootOverride), so the manager reads a built model.json back and the test publishes
// each output directory to the registry.
class TempBuildStorage implements IBuildStorageProvider
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
        const dir = join(this.root, "out", key);
        if (!this.outputs.has(key))
        {
            await new NodeFsStorage(dir).CreateDirectory("");
            this.outputs.set(key, dir);
        }
        return { Storage: new NodeFsStorage(dir), Path: dir };
    }
}

// Wires an in-memory registry, a temp-dir build provider, and the npm build system into the
// handful of moves the tests make: build a project, publish its output, and read published
// packages back through a RegistrySource.
class BuildHarness
{
    public readonly Registry: LocalNpmRegistry;
    private readonly client: PackageRegistryClient;
    private readonly provider: TempBuildStorage;

    constructor(root: string)
    {
        this.Registry = new LocalNpmRegistry(new FakeStorage());
        this.client = new PackageRegistryClient(this.Registry);
        this.provider = new TempBuildStorage(root);
    }

    public Source(): IPackageSource
    {
        return new RegistrySource(this.Registry);
    }

    public Build(project: FixtureProject, source: IPackageSource, generators: readonly IBuildAction<TodlBuildContext>[] = []): Promise<ProjectBuildOutput>
    {
        return new TodlProjectBuildManager(this.registryWith(generators), this.provider).Build({
            Project: project.Project,
            Manifest: project.Manifest,
            BuildSystemId: "npm-package",
            Source: source,
            Options: { OutputRootOverride: project.Id },
        });
    }

    public SolutionManager(): SolutionBuildManager
    {
        return new SolutionBuildManager(this.registryWith([]), this.provider);
    }

    public async Publish(outputPath: string): Promise<void>
    {
        await this.client.publish(outputPath);
    }

    public PublishedNames(): Promise<string[]>
    {
        return this.Registry.ListPackages();
    }

    private registryWith(generators: readonly IBuildAction<TodlBuildContext>[]): BuildSystemRegistry<TodlBuildContext, ProjectManifest>
    {
        const registry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        registry.Register(new NpmPackageBuildSystem(generators));
        return registry;
    }
}

function presentationGenerator(): IBuildAction<TodlBuildContext>
{
    return new GeneratePresentationAction(new TestPresentationBaker(), LIBRARY_BAKE);
}

describe("build lifecycle (build → presentation → publish → resolve)", () =>
{
    test("builds a meta-model into the npm package layout and publishes it to the in-memory registry", async (t) =>
    {
        const harness = new BuildHarness(await tempRoot(t));
        const meta = fsProject(META_MODEL);

        const output = await harness.Build(meta, new EmptySource());

        assert.equal(output.Result.Ok, true, JSON.stringify(output.Result.Diagnostics));
        for (const file of ["model.json", "package.json", "index.js", "index.d.ts"])
        {
            assert.ok(output.Result.Artifacts.includes(file), `output has ${file}`);
        }

        await harness.Publish(output.Result.OutputPath!);
        assert.deepEqual(await harness.PublishedNames(), ["@pragmatic-tech-ai/todl-test-tech-architecture"]);

        // The published package resolves back through a RegistrySource (the terminal source
        // of the resolution chain), own-only document + no recorded deps for a meta-model.
        const resolved = await harness.Source().TryGet({ kind: PackageKind.MetaModel, id: meta.Id, version: "0.1.0" });
        assert.notEqual(resolved, undefined);
        assert.ok(resolved!.Document.nodes.length > 0);
        assert.deepEqual(resolved!.Dependencies, []);
    });

    test("builds a library against the registry-resolved meta-model, generating presentation, then publishes it", async (t) =>
    {
        const harness = new BuildHarness(await tempRoot(t));

        // Publish the meta-model first so the library resolves its base from the registry only.
        const meta = await harness.Build(fsProject(META_MODEL), new EmptySource());
        assert.equal(meta.Result.Ok, true, JSON.stringify(meta.Result.Diagnostics));
        await harness.Publish(meta.Result.OutputPath!);

        const lib = fsProject(MICROSOFT);
        const output = await harness.Build(lib, harness.Source(), [presentationGenerator()]);

        assert.equal(output.Result.Ok, true, JSON.stringify(output.Result.Diagnostics));
        // Presentation was generated into the output.
        assert.ok(output.Result.Artifacts.includes("presentation/presentation.compiled.json"), "wrote presentation.compiled.json");
        assert.ok(output.Result.Artifacts.includes("presentation/icon-index.json"), "wrote icon-index.json");

        // The stamped resource key reached model.json (an icon application carries a key).
        const model = JSON.parse(readFileSync(join(output.Result.OutputPath!, "model.json"), "utf8")) as TodlDocument;
        const stamped = model.nodes.some((n) => n.type === "icon" && typeof (n.attrs as Record<string, unknown>)["key"] === "string");
        assert.ok(stamped, "an icon node in model.json carries a stamped resource key");

        // The library records its meta-model as a pinned dependency.
        const pkg = JSON.parse(readFileSync(join(output.Result.OutputPath!, "package.json"), "utf8")) as { dependencies: Record<string, string> };
        assert.ok(pkg.dependencies["@pragmatic-tech-ai/todl-test-tech-architecture"] !== undefined, "records the meta-model dependency");

        await harness.Publish(output.Result.OutputPath!);
        const names = await harness.PublishedNames();
        assert.ok(names.includes("@pragmatic-tech-ai/todl-test-tech-architecture"));
        assert.ok(names.includes("@pragmatic-tech-ai/todl-test-microsoft"));
    });

    test("fails the build when the library's meta-model base cannot be resolved", async (t) =>
    {
        const harness = new BuildHarness(await tempRoot(t));

        // No meta-model published; an empty source resolves nothing.
        const output = await harness.Build(fsProject(MICROSOFT), new EmptySource());

        assert.equal(output.Result.Ok, false);
        assert.equal(output.Result.Artifacts.length, 0, "nothing promoted");
        assert.ok(output.Result.Diagnostics.some((d) => /not published/i.test(d.message) && d.message.includes("todl-test-tech-architecture")), "reports the unresolved base");
    });

    test("fails the build (no promotion) when a referenced icon file is missing", async (t) =>
    {
        const harness = new BuildHarness(await tempRoot(t));
        await harness.Publish((await harness.Build(fsProject(META_MODEL), new EmptySource())).Result.OutputPath!);

        // Hide one icon the library's model references; the presentation bake must fail.
        const hidden = "resources/teams.svg";
        const lib = fsProject(MICROSOFT, new HidingStorage(new NodeFsStorage(join(TEST_PROJECTS, MICROSOFT)), hidden));
        const output = await harness.Build(lib, harness.Source(), [presentationGenerator()]);

        assert.equal(output.Result.Ok, false);
        assert.equal(output.Result.Artifacts.length, 0, "nothing promoted");
        assert.ok(output.Result.Diagnostics.some((d) => d.message.includes(hidden)), "names the missing icon");
    });

    test("builds a whole solution (meta-model + two libraries) in dependency order and publishes all three", async (t) =>
    {
        const harness = new BuildHarness(await tempRoot(t));
        const meta = fsProject(META_MODEL);
        const aws = fsProject(AWS);
        const microsoft = fsProject(MICROSOFT);

        // Libraries listed before the meta-model to prove the manager reorders; the external
        // source is empty, so each library can only resolve its base from the meta-model's
        // just-built output threaded through the accumulating BuildOutputSource.
        const result = await harness.SolutionManager().Build({
            Projects: [microsoft, aws, meta],
            BuildSystemId: "npm-package",
            ExternalSource: new EmptySource(),
        });

        assert.equal(result.Ok, true, JSON.stringify(result.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));
        assert.ok(result.Order.indexOf(meta.Id) < result.Order.indexOf(aws.Id), "meta-model builds before aws");
        assert.ok(result.Order.indexOf(meta.Id) < result.Order.indexOf(microsoft.Id), "meta-model builds before microsoft");
        assert.ok(result.Projects.every((p) => p.Status === ProjectBuildStatus.Built), "every project built");

        // Publish each built output; the in-memory registry then serves the whole solution.
        for (const outcome of result.Projects) await harness.Publish(outcome.Result!.OutputPath!);
        const names = await harness.PublishedNames();
        for (const id of ["todl-test-tech-architecture", "todl-test-aws", "todl-test-microsoft"])
        {
            assert.ok(names.includes(`@pragmatic-tech-ai/${id}`), `registry serves ${id}`);
        }
    });
});
