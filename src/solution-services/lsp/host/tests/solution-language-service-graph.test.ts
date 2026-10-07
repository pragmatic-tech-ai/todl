import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, FileChangeKind, Observable, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { SolutionLanguageService } from "../solution-language-service.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { SolutionMember } from "../../../solution-manager/engine/solution-member.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { Severity } from "../../../../compiler-services/diagnostics/diagnostic.js";
import { SolutionGraph } from "../solution-graph.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

// A manager double whose ActiveSolution can be SWAPPED (raising PropertyChanged), so a
// solution-switch can be exercised end-to-end through the service's lifecycle wiring.
class FakeManager extends Observable
{
    private static readonly ActiveSolutionProperty = "ActiveSolution";
    private active: Solution | undefined;

    constructor(active: Solution | undefined)
    {
        super();
        this.active = active;
    }

    public get ActiveSolution(): Solution | undefined
    {
        return this.active;
    }

    public set ActiveSolution(value: Solution | undefined)
    {
        const old = this.active;
        this.active = value;
        this.RaisePropertyChanged(FakeManager.ActiveSolutionProperty, old, value);
    }
}

// A META / LIB / ARCH solution over FakeStorage, each member rooted at a distinct bare
// URI so the full source URI (root + relative path) matches the SolutionGraph fixtures.
// META is the only meta-model; LIB binds it and carries an icon'd taxonomy term; ARCH
// binds LIB and declares the model under test. Static helpers on one class — no free
// functions.
class World
{
    private static readonly MetaId = "tech-architecture";
    private static readonly LibId = "microsoft";
    private static readonly ArchName = "arch";
    private static readonly Version = "1.0.0";
    private static readonly ModelFile = "a.todl";
    private static readonly MetaFile = "meta.todl";
    private static readonly LibFile = "lib.todl";

    private static readonly MetaSource = "namespace ea { concept App { note : string?; peer : App?; } }";
    private static readonly LibSource =
        'namespace lib { import ea; taxonomy MS : represents App { term azure { annotate icon { path = "resources/azure.svg"; } } } }';
    private static readonly ArchSource = 'namespace app { import ea; model M : ea { App a { note = "x"; } } }';

    public readonly Service: SolutionLanguageService;
    public readonly Manager: FakeManager;
    public readonly Solution: Solution;
    public readonly Meta: IStorage;
    public readonly Lib: IStorage;
    public readonly Arch: IStorage;

    constructor()
    {
        this.Meta = World.Storage("mm", World.MetaFile, World.MetaSource,
            { type: ProjectType.MetaModel, name: World.MetaId, version: 1, id: World.MetaId, packageVersion: World.Version });
        this.Lib = World.Storage("lib", World.LibFile, World.LibSource,
            {
                type: ProjectType.Library, name: World.LibId, version: 1, id: World.LibId, packageVersion: World.Version,
                metaModels: [{ id: World.MetaId, version: World.Version }],
            });
        this.Arch = World.Storage("arch", World.ModelFile, World.ArchSource,
            {
                type: ProjectType.Architecture, name: World.ArchName, version: 1,
                libraries: [{ id: World.LibId, version: World.Version }],
            });
        this.Solution = new Solution("S");
        this.Solution.AddMember(World.MetaId, ProjectType.MetaModel).Storage = this.Meta;
        this.Solution.AddMember(World.LibId, ProjectType.Library).Storage = this.Lib;
        this.Solution.AddMember(World.ArchName, ProjectType.Architecture).Storage = this.Arch;
        this.Manager = new FakeManager(this.Solution);
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, this.Manager as unknown as SolutionManagerService);
        this.Service = new SolutionLanguageService(provider);
    }

    // Build a member storage holding a manifest + a single source file.
    public static Storage(root: string, file: string, source: string, manifest: ProjectManifest): IStorage
    {
        const storage = new FakeStorage(root);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(file, source);
        return storage;
    }

    // A standalone meta-model member storage declaring one concept, bound to nothing.
    public static MetaStorage(root: string, id: string, source: string): IStorage
    {
        return World.Storage(root, "m.todl", source,
            { type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: "1.0.0" });
    }

    // A single-meta-model solution, for the solution-switch test.
    public static SoloMetaSolution(name: string, root: string, id: string, source: string): { solution: Solution; storage: IStorage }
    {
        const storage = World.MetaStorage(root, id, source);
        const solution = new Solution(name);
        solution.AddMember(id, ProjectType.MetaModel).Storage = storage;
        return { solution, storage };
    }

    // Add a member to the live solution WITH its storage already set, so the Inserted
    // event the service observes already carries the storage (mirrors a real open).
    public InsertMeta(root: string, id: string, source: string): IStorage
    {
        const storage = World.MetaStorage(root, id, source);
        const member = new SolutionMember({ path: id, type: ProjectType.MetaModel });
        member.Storage = storage;
        this.Solution.Members.Add(member);
        return storage;
    }

    public MemberFor(storage: IStorage): SolutionMember
    {
        for (const member of this.Solution.Members) if (member.Storage === storage) return member;
        throw new Error("no member for storage");
    }
}

test("DidChange to a member replaces its slice and fires GraphChanged", async () =>
{
    const world = new World();
    await world.Service.Ready();

    let fired: string[] = [];
    world.Service.GraphChanged.subscribe((c) => { fired = [...c.memberIds]; });

    world.Service.DidChange("arch/a.todl", 'namespace app { import ea; model M : ea { App a { note = "y"; } } }');
    await world.Service.Flush();

    const view = await world.Service.ModelView(world.Arch);
    assert.equal(view?.model.attr("app.a", "note"), "y");
    assert.ok(fired.includes("arch"), `GraphChanged should fire with "arch"; fired = ${JSON.stringify(fired)}`);
});

test("ModelView returns the shared graph for a member and undefined for a non-member", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const fromArch = await world.Service.ModelView(world.Arch);
    const fromLib = await world.Service.ModelView(world.Lib);
    assert.ok(fromArch !== undefined && fromLib !== undefined);
    // The SAME Repository instance for every consumer in the solution.
    assert.equal(fromArch.model, fromLib.model);
    assert.ok(fromArch.model.has("app.M"));

    assert.equal(await world.Service.ModelView(new FakeStorage("outside")), undefined);
});

test("ModelView exposes provenanceOf mapping a node to its authoring file uri", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const view = await world.Service.ModelView(world.Arch);
    assert.ok(view !== undefined);
    assert.ok(view.provenanceOf.get("app.M")?.endsWith("a.todl"), `got ${String(view.provenanceOf.get("app.M"))}`);
});

test("Resources through the service resolves an icon annotation to its source member storage", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const res = await world.Service.Resources("lib.MS.azure");
    assert.equal(res.length, 1);
    assert.equal(res[0]!.path, "resources/azure.svg");
    assert.equal(res[0]!.storage, world.Lib);
});

test("a solution switch re-assembles the graph for the new solution", async () =>
{
    const world = new World();
    await world.Service.Ready();
    assert.ok((await world.Service.ModelView(world.Arch))?.model.has("ea.App"), "S1 node present before switch");

    const s2 = World.SoloMetaSolution("S2", "mm2", "other-mm", "namespace o2 { concept Zeta { } }");
    world.Manager.ActiveSolution = s2.solution;
    await world.Service.WhenIdle();

    const view = await world.Service.ModelView(s2.storage);
    assert.ok(view !== undefined, "S2 member resolves against the new graph");
    assert.ok(view.model.has("o2.Zeta"), "S2 node present after switch");
    assert.ok(!view.model.has("ea.App"), "S1 node gone after switch");
    // An S1 member is no longer a member of the active solution.
    assert.equal(await world.Service.ModelView(world.Arch), undefined);
});

test("a member insert and remove rebuild the graph", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const extra = world.InsertMeta("extra", "extra", "namespace extra { concept Zeta { } }");
    await world.Service.WhenIdle();
    assert.ok((await world.Service.ModelView(world.Arch))?.model.has("extra.Zeta"), "inserted member built into the graph");

    world.Solution.RemoveMember(world.MemberFor(extra));
    await world.Service.WhenIdle();
    assert.ok(!(await world.Service.ModelView(world.Arch))?.model.has("extra.Zeta"), "removed member dropped from the graph");
});

test("editing a base member replaces it AND its dependent, GraphChanged carries both", async () =>
{
    const world = new World();
    await world.Service.Ready();

    let fired: string[] = [];
    world.Service.GraphChanged.subscribe((c) => { fired = [...c.memberIds]; });

    world.Service.DidChange("lib/lib.todl",
        'namespace lib { import ea; taxonomy MS : represents App { term azure { } term m365 { } } }');
    await world.Service.Flush();

    const view = await world.Service.ModelView(world.Arch);
    assert.ok(view?.model.has("lib.MS.m365"), "new base node present");
    assert.ok(fired.includes("microsoft") && fired.includes("arch"),
        `cascade should reload the base member and its dependent; fired = ${JSON.stringify(fired)}`);
});

// Sibling-file fixtures: a second `.todl` in the ARCH member, both an independent one
// (for the file-granular DidChange test) and a referrer of a.todl (for add/remove).
class SiblingFiles
{
    public static readonly BUri = "arch/b.todl";
    public static readonly AUri = "arch/a.todl";
    public static readonly BFile = "b.todl";
    public static readonly AFile = "a.todl";
    public static readonly IndependentB = 'namespace app2 { import ea; model N : ea { App c { note = "p"; } } }';
    public static readonly EditedA = 'namespace app { import ea; model M : ea { App a { note = "y"; } } }';
    public static readonly EditedB = 'namespace app2 { import ea; model N : ea { App c { note = "q"; } } }';
    public static readonly OriginalA = 'namespace app { import ea; model M : ea { App a { note = "x"; } } }';
    public static readonly ReferrerB = 'namespace app2 { import ea; import app; model N : ea { App c { peer = app.a; } } }';
    public static readonly SettleAttempts = 100;
    public static readonly SettleMs = 20;

    public static async Until(condition: () => Promise<boolean>): Promise<boolean>
    {
        for (let i = 0; i < SiblingFiles.SettleAttempts; i++)
        {
            if (await condition()) return true;
            await new Promise<void>((r) => setTimeout(r, SiblingFiles.SettleMs));
        }
        return false;
    }
}

test("DidChange to two sibling files of one member fires a file-granular change per file", async () =>
{
    const world = new World();
    await world.Arch.WriteText(SiblingFiles.BFile, SiblingFiles.IndependentB);
    await world.Service.Ready();

    const fired: string[][] = [];
    world.Service.GraphChanged.subscribe((c) => { fired.push([...c.fileIds]); });

    world.Service.DidChange(SiblingFiles.AUri, SiblingFiles.EditedA);
    world.Service.DidChange(SiblingFiles.BUri, SiblingFiles.EditedB);
    await world.Service.Flush();

    const view = await world.Service.ModelView(world.Arch);
    assert.equal(view?.model.attr("app.a", "note"), "y");
    assert.equal(view?.model.attr("app2.c", "note"), "q");
    assert.ok(fired.some((f) => f.length === 1 && f[0] === SiblingFiles.AUri), `a.todl change expected; fired = ${JSON.stringify(fired)}`);
    assert.ok(fired.some((f) => f.length === 1 && f[0] === SiblingFiles.BUri), `b.todl change expected; fired = ${JSON.stringify(fired)}`);
});

test("DidChange for a file not yet in the graph falls back to the member-granular path", async () =>
{
    const world = new World();
    await world.Service.Ready();

    await world.Arch.WriteText(SiblingFiles.BFile, SiblingFiles.IndependentB);
    world.Service.DidChange(SiblingFiles.BUri, SiblingFiles.IndependentB);
    await world.Service.Flush();

    const view = await world.Service.ModelView(world.Arch);
    assert.equal(view?.model.attr("app2.c", "note"), "p", "the new file is loaded via the member fallback");
});

test("removing a referenced file dangles its referrer; re-adding clears it (member-granular add/remove)", async () =>
{
    const world = new World();
    await world.Arch.WriteText(SiblingFiles.BFile, SiblingFiles.ReferrerB);
    await world.Service.Ready();
    await world.Service.WhenIdle(); // the content watcher's baseline sweep must finish first
    // The shared graph's own per-uri diagnostics (the layer this task routes), read via the
    // service's private graph — DiagnosticsFor goes through the per-project analysis engine.
    const graph = (world.Service as unknown as { solutionGraph: SolutionGraph }).solutionGraph;
    const errorsOnB = async (): Promise<number> =>
        (graph.DiagnosticsByUri().get(SiblingFiles.BUri) ?? []).filter((d) => d.severity === Severity.Error).length;
    assert.equal(await errorsOnB(), 0, "no errors before removal");

    await world.Arch.Delete(SiblingFiles.AFile);
    (world.Arch as FakeStorage).EmitFileChange(SiblingFiles.AFile, FileChangeKind.Removed, false);
    assert.ok(await SiblingFiles.Until(async () => (await errorsOnB()) > 0), "referrer gains dangling diagnostics after removal");

    await world.Arch.WriteText(SiblingFiles.AFile, SiblingFiles.OriginalA);
    (world.Arch as FakeStorage).EmitFileChange(SiblingFiles.AFile, FileChangeKind.Added, false);
    assert.ok(await SiblingFiles.Until(async () => (await errorsOnB()) === 0), "diagnostics clear after re-adding");
});
