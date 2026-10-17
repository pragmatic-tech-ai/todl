import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, Observable, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { SolutionLanguageService } from "../solution-language-service.js";
import { GraphBuildState } from "../graph-build-state.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

// A manager double whose ActiveSolution can be SWAPPED (raising PropertyChanged), so a
// solution switch is exercised end-to-end through the service's lifecycle wiring.
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

// Solution fixtures over FakeStorage: a single meta-model solution (the happy path) and
// a two-member solution whose members collide on id (the failing build). Static helpers
// on one class, plus the service + manager + build-state recorder for one test.
class BuildStateWorld
{
    private static readonly MetaFile = "m.todl";
    private static readonly Version = "1.0.0";
    private static readonly DuplicateId = "dup";
    private static readonly SettleMs = 50;

    private static readonly DuplicateRoots = ["d1", "d2"];

    public static readonly GraphEntry = "graph";
    public static readonly MetaUri = "mm/m.todl";
    public static readonly MetaSource = "namespace ea { concept App { note : string?; } }";
    public static readonly EditedMetaSource = "namespace ea { concept App { note : string?; peer : App?; } }";

    public readonly Service: SolutionLanguageService;
    public readonly Manager: FakeManager;
    public readonly Emissions: GraphBuildState[] = [];
    // An interleaved log of build-state emissions and graph commits, so a test can assert
    // the settle lands only AFTER the latest rebuild committed.
    public readonly Log: string[] = [];

    constructor(solution: Solution)
    {
        this.Manager = new FakeManager(solution);
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, this.Manager as unknown as SolutionManagerService);
        this.Service = new SolutionLanguageService(provider);
        this.Service.BuildStateChanged.subscribe((state) =>
        {
            this.Emissions.push(state);
            this.Log.push(state);
        });
        this.Service.GraphChanged.subscribe(() => this.Log.push(BuildStateWorld.GraphEntry));
    }

    public static Storage(root: string, file: string, source: string, manifest: ProjectManifest): IStorage
    {
        const storage = new FakeStorage(root);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(file, source);
        return storage;
    }

    public static MetaSolution(name: string, root: string, id: string, source: string): Solution
    {
        const storage = BuildStateWorld.Storage(root, BuildStateWorld.MetaFile, source,
            { type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: BuildStateWorld.Version });
        const solution = new Solution(name);
        solution.AddMember(id, ProjectType.MetaModel).Storage = storage;
        return solution;
    }

    // Two meta-model members under distinct roots whose manifests both declare the SAME
    // id, so SolutionGraph.Build rejects with a duplicate-member-id error.
    public static DuplicateSolution(): Solution
    {
        const solution = new Solution("Dup");
        for (const root of BuildStateWorld.DuplicateRoots)
        {
            const storage = BuildStateWorld.Storage(root, BuildStateWorld.MetaFile, BuildStateWorld.MetaSource,
                {
                    type: ProjectType.MetaModel, name: BuildStateWorld.DuplicateId, version: 1,
                    id: BuildStateWorld.DuplicateId, packageVersion: BuildStateWorld.Version,
                });
            solution.AddMember(root, ProjectType.MetaModel).Storage = storage;
        }
        return solution;
    }

    public static Default(): BuildStateWorld
    {
        return new BuildStateWorld(BuildStateWorld.MetaSolution("S", "mm", "tech-architecture", BuildStateWorld.MetaSource));
    }

    public async Settle(): Promise<void>
    {
        await this.Service.Ready();
        await this.Service.WhenIdle();
    }

    // Let any stray timer / microtask run, then drain the queue again.
    public async Linger(): Promise<void>
    {
        await new Promise<void>((resolve) => setTimeout(resolve, BuildStateWorld.SettleMs));
        await this.Service.WhenIdle();
    }
}

test("is Building at construction then Ready after warmup", async () =>
{
    const world = BuildStateWorld.Default();
    assert.equal(world.Service.BuildState, GraphBuildState.Building);

    await world.Settle();
    assert.equal(world.Service.BuildState, GraphBuildState.Ready);
    assert.deepEqual(world.Emissions, [GraphBuildState.Ready]);
    world.Service.dispose();
});

test("a solution switch goes Building then Ready", async () =>
{
    const world = BuildStateWorld.Default();
    await world.Settle();
    world.Emissions.length = 0;

    world.Manager.ActiveSolution = BuildStateWorld.MetaSolution("S2", "mm2", "other-mm", "namespace o2 { concept Zeta { } }");
    assert.equal(world.Service.BuildState, GraphBuildState.Building, "Building synchronously on the switch");
    await world.Service.WhenIdle();

    assert.deepEqual(world.Emissions, [GraphBuildState.Building, GraphBuildState.Ready]);
    assert.equal(world.Service.BuildState, GraphBuildState.Ready);
    world.Service.dispose();
});

test("a failing build settles Failed", async () =>
{
    const world = new BuildStateWorld(BuildStateWorld.DuplicateSolution());
    await world.Settle();

    assert.ok(world.Service.LastGraphBuildError !== undefined, "the duplicate member id is recorded");
    assert.equal(world.Service.BuildState, GraphBuildState.Failed);
    assert.deepEqual(world.Emissions, [GraphBuildState.Failed]);
    world.Service.dispose();
});

test("a solution switch to a failing solution goes Building then Failed", async () =>
{
    const world = BuildStateWorld.Default();
    await world.Settle();
    world.Emissions.length = 0;

    world.Manager.ActiveSolution = BuildStateWorld.DuplicateSolution();
    await world.Service.WhenIdle();

    assert.deepEqual(world.Emissions, [GraphBuildState.Building, GraphBuildState.Failed]);
    world.Service.dispose();
});

test("two rapid switches settle once, to the latest", async () =>
{
    const world = BuildStateWorld.Default();
    await world.Settle();
    world.Emissions.length = 0;
    world.Log.length = 0;

    world.Manager.ActiveSolution = BuildStateWorld.MetaSolution("A", "ma", "a-mm", "namespace a { concept Alpha { } }");
    world.Manager.ActiveSolution = BuildStateWorld.MetaSolution("B", "mb", "b-mm", "namespace b { concept Beta { } }");
    await world.Service.WhenIdle();

    assert.equal(world.Service.BuildState, GraphBuildState.Ready);
    assert.deepEqual(world.Emissions, [GraphBuildState.Building, GraphBuildState.Ready]);
    // The stale (first) switch's rebuild must NOT settle: Ready lands only after the
    // latest switch's rebuild committed, i.e. after BOTH graph commits.
    assert.deepEqual(world.Log,
        [GraphBuildState.Building, BuildStateWorld.GraphEntry, BuildStateWorld.GraphEntry, GraphBuildState.Ready]);

    const count = world.Emissions.length;
    await world.Linger();
    assert.equal(world.Emissions.length, count, "no emission after WhenIdle resolved");
    world.Service.dispose();
});

test("GraphRevision increments on every graph Changed", async () =>
{
    const world = BuildStateWorld.Default();
    await world.Settle();
    assert.ok(world.Service.GraphRevision > 0, "the warmup build already committed a revision");

    const before = world.Service.GraphRevision;
    let changes = 0;
    world.Service.GraphChanged.subscribe(() => { changes++; });
    world.Service.DidChange(BuildStateWorld.MetaUri, BuildStateWorld.EditedMetaSource);
    await world.Service.WhenIdle();

    assert.ok(changes > 0, "the edit committed at least one graph change");
    assert.equal(world.Service.GraphRevision - before, changes);
    world.Service.dispose();
});

test("incremental member rebuild does not change BuildState", async () =>
{
    const world = BuildStateWorld.Default();
    await world.Settle();
    world.Emissions.length = 0;

    world.Service.DidChange(BuildStateWorld.MetaUri, BuildStateWorld.EditedMetaSource);
    await world.Service.WhenIdle();

    assert.deepEqual(world.Emissions, []);
    assert.equal(world.Service.BuildState, GraphBuildState.Ready);
    world.Service.dispose();
});
