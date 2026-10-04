import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { Position } from "vscode-languageserver-types";
import { SolutionLanguageService } from "../solution-language-service.js";
import { AnalysisEngineKey, type IAnalysisEngine } from "../i-analysis-engine.js";
import { AnalyzeKind, type AnalyzeRequest, type AnalyzeResponse } from "../../analysis/protocol.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { SolutionBaseResolver } from "../../../solution-manager/engine/solution-base-resolver.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import type { SolutionMember } from "../../../solution-manager/engine/solution-member.js";
import {
    ProjectEvents, ProjectEventsKey, ProjectEventKind, type ProjectEvent,
} from "../../../project-services/generators/project-events.js";
import { PackageStoreKey } from "../../../todl-build-system/package-store.js";
import type { IPackageSource, SourcedPackage } from "../../../todl-build-system/package-source.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { PackageRef } from "../../../../publish/publish.js";
import type { TodlDocument } from "../../../../compiler-services/emit/json.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

// Fixtures over a real Solution + a real SolutionBaseResolver (the same instance
// the service resolves and the test primes), mirroring the Task-3 / Task-12 tests.
// Static helpers on a class — no free functions.
class Fixtures
{
    private static readonly ModelFileName = "model.todl";
    private static readonly MetaModelNamespace = "acme";
    private static readonly RootPrefix = "file:///solution/";
    public static readonly Pos: Position = { line: 0, character: 0 };

    // A member storage rooted at a distinct URI (so each member partitions cleanly in
    // the ProjectRegistry) holding a manifest + one .todl file.
    public static Storage(id: string, files: Record<string, string>): IStorage
    {
        const storage = new FakeStorage(`${Fixtures.RootPrefix}${id}`);
        for (const [path, content] of Object.entries(files)) storage.WriteText(path, content);
        return storage;
    }

    // A meta-model member's files — a producer whose own manifest binds nothing.
    public static MetaModelFiles(id: string, version: string, concept: string): Record<string, string>
    {
        const manifest: ProjectManifest = { type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: version };
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace ${Fixtures.MetaModelNamespace} { concept ${concept} { label : string?; } }`,
        };
    }

    // A library member's files that bind a meta-model producer by id — so the library
    // is a transitive dependent of that meta-model in the resolver's eviction graph.
    public static LibraryFiles(id: string, metaModelId: string, metaModelVersion: string, term: string, baseConcept: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id, packageVersion: "1.0.0",
            metaModels: [{ id: metaModelId, version: metaModelVersion }],
        };
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace lib_${id} { concept ${term} : ${Fixtures.MetaModelNamespace}.${baseConcept} { } }`,
        };
    }

    // The manifest JSON a member's storage holds, re-parsed for raising a ProjectEvent.
    public static Manifest(storage: IStorage): Promise<ProjectManifest>
    {
        return storage.ReadText(PROJECT_MANIFEST_FILENAME).then((t) => JSON.parse(t) as ProjectManifest);
    }

    // An empty inner published source — live producers resolve from their own sources,
    // so published is never consulted in these fixtures.
    public static Published(): IPackageSource
    {
        return { TryGet(): Promise<SourcedPackage | undefined> { return Promise.resolve(undefined); } };
    }
}

// A world of one solution, a shared resolver, and the service under test — the
// common arrangement each lifecycle test builds on.
class World
{
    public readonly Solution: Solution;
    public readonly Resolver: SolutionBaseResolver;
    public readonly Events: ProjectEvents;
    public readonly Service: SolutionLanguageService;
    private readonly members = new Map<string, SolutionMember>();

    private constructor(solution: Solution, resolver: SolutionBaseResolver, events: ProjectEvents, service: SolutionLanguageService, members: Map<string, SolutionMember>)
    {
        this.Solution = solution;
        this.Resolver = resolver;
        this.Events = events;
        this.Service = service;
        this.members = members;
    }

    // Build a solution whose members are the given { id, storage } pairs, wire a shared
    // resolver + project-event bus, and construct the service over the same provider.
    public static Build(members: { id: string; type: string; storage: IStorage }[], engine?: IAnalysisEngine): World
    {
        const solution = new Solution("S");
        const byId = new Map<string, SolutionMember>();
        for (const m of members)
        {
            const member = solution.AddMember(m.id, m.type);
            member.Storage = m.storage;
            byId.set(m.id, member);
        }
        const manager = { ActiveSolution: solution };
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService);
        provider.registerInstance(PackageStoreKey, Fixtures.Published() as never);
        const resolver = new SolutionBaseResolver(provider);
        provider.registerInstance(SolutionBaseResolver.Key, resolver);
        const events = new ProjectEvents();
        provider.registerInstance(ProjectEventsKey, events);
        if (engine !== undefined) provider.registerInstance(AnalysisEngineKey, engine);
        const service = new SolutionLanguageService(provider);
        return new World(solution, resolver, events, service, byId);
    }

    public Member(id: string): SolutionMember
    {
        return this.members.get(id)!;
    }

    // Prime the resolver's compile cache + dependency graph for the given member ids,
    // so a later Invalidate can evict transitive dependents.
    public async Prime(...ids: string[]): Promise<void>
    {
        for (const id of ids) await this.Resolver.TryGet({ id, version: "1.0.0" } as PackageRef);
    }

    // Raise a ReferencesChanged event for the member with the given id.
    public async RaiseReferencesChanged(id: string): Promise<void>
    {
        const storage = this.Member(id).Storage!;
        const manifest = await Fixtures.Manifest(storage);
        const event: ProjectEvent = {
            Kind: ProjectEventKind.ReferencesChanged,
            ProjectType: manifest.type,
            Project: storage,
            Manifest: manifest,
        };
        await this.Events.Raise(event);
    }

    // Remove the member with the given id and wait for the fire-and-forget maintenance.
    public async RemoveMember(id: string): Promise<void>
    {
        this.Solution.RemoveMember(this.Member(id));
        await this.Service.WhenIdle();
    }
}

test("removing a member evicts it and its dependents only", async () =>
{
    // lib depends on mm; removing mm must evict both. other is untouched.
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
        { id: "other", type: "meta-model", storage: Fixtures.Storage("other", Fixtures.MetaModelFiles("other", "1.0.0", "Unrelated")) },
    ]);
    await world.Prime("mm", "lib", "other");

    await world.RemoveMember("mm");

    assert.deepEqual([...world.Resolver.StaleMemberIds].sort(), ["lib", "mm"]);
});

test("a reference change on one member evicts only that member + dependents", async () =>
{
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
        { id: "other", type: "meta-model", storage: Fixtures.Storage("other", Fixtures.MetaModelFiles("other", "1.0.0", "Unrelated")) },
    ]);
    await world.Prime("mm", "lib", "other");

    await world.RaiseReferencesChanged("mm");

    assert.deepEqual([...world.Resolver.StaleMemberIds].sort(), ["lib", "mm"]);
});

// File-watch wiring is deferred (see task report): the service holds only each
// member's IStorage, not a ProjectContentStore, so a per-member content watcher
// would be a new ownership responsibility. This covers test 3's eviction + token
// bump via the ReferencesChanged mechanism that is wired, on a member with no
// dependents.
test("a change under a member evicts only that member + dependents and bumps the token", async () =>
{
    const world = World.Build([
        { id: "c", type: "meta-model", storage: Fixtures.Storage("c", Fixtures.MetaModelFiles("c", "1.0.0", "Standalone")) },
    ]);
    await world.Prime("c");
    const before = world.Service.BaseSetToken;

    await world.RaiseReferencesChanged("c");

    assert.deepEqual([...world.Resolver.StaleMemberIds], ["c"]);
    assert.ok(world.Service.BaseSetToken > before);
});

test("dispose() unsubscribes (no eviction after dispose)", async () =>
{
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
    ]);
    await world.Prime("mm", "lib");
    const tokenBefore = world.Service.BaseSetToken;

    world.Service.dispose();
    await world.RemoveMember("mm");

    // The Members subscription was torn down, so no targeted eviction ran and the
    // token did not move.
    assert.deepEqual([...world.Resolver.StaleMemberIds], []);
    assert.equal(world.Service.BaseSetToken, tokenBefore);
});

test("dispose() truly unsubscribes the ReferencesChanged arm (handler detached, no effect)", async () =>
{
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
    ]);
    await world.Prime("mm", "lib");
    assert.equal(world.Events.SubscriberCount, 1);   // the service's arm is attached to the bus
    const tokenBefore = world.Service.BaseSetToken;

    world.Service.dispose();

    // Detached, not merely inert — the handler is gone from the bus.
    assert.equal(world.Events.SubscriberCount, 0);

    await world.RaiseReferencesChanged("mm");
    assert.deepEqual([...world.Resolver.StaleMemberIds], []);   // no Invalidate ran
    assert.equal(world.Service.BaseSetToken, tokenBefore);      // no token bump
});

// Records whether each request carried Context.Bases, so the base-set gating can be
// asserted directly (mirrors Task 12's SpyEngine).
class SpyEngine implements IAnalysisEngine
{
    public readonly BasesSeen: boolean[] = [];

    public async Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>
    {
        this.BasesSeen.push(request.Context.Bases !== undefined);
        return { Kind: AnalyzeKind.Completion, Items: [] };
    }
}

test("after a token bump the next request for the same project re-sends Context.Bases", async () =>
{
    const spy = new SpyEngine();
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
    ], spy);
    await world.Prime("mm");
    const uri = "file:///solution/mm/model.todl";
    world.Service.DidChange(uri, "concept x { }");

    await world.Service.CompletionsAt(uri, Fixtures.Pos);   // project changed → bases sent
    await world.Service.CompletionsAt(uri, Fixtures.Pos);   // same project, same token → suppressed
    await world.RaiseReferencesChanged("mm");               // token bump
    await world.Service.CompletionsAt(uri, Fixtures.Pos);   // token moved → bases re-sent

    assert.deepEqual(spy.BasesSeen, [true, false, true]);
});

// Captures the last Context.Bases each project URI actually received, so a test can
// assert WHICH base documents a dependent re-sends (not merely that it sent some).
class CapturingEngine implements IAnalysisEngine
{
    public readonly BasesByUri = new Map<string, readonly TodlDocument[]>();

    public async Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>
    {
        if (request.Context.Bases !== undefined) this.BasesByUri.set(request.Uri, request.Context.Bases);
        return { Kind: AnalyzeKind.Completion, Items: [] };
    }
}

const LibUri = "file:///solution/lib/model.todl";

// A1 — a reference/content change on a base member must refresh its transitive
// DEPENDENTS' warm bases too, not just the changed member's own. The dependent's
// re-sent bases must reflect the base member's NEW compiled document.
test("editing a base member refreshes its dependents' warm bases (dependent re-sends the NEW base document)", async () =>
{
    const engine = new CapturingEngine();
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
    ], engine);
    await world.Prime("mm", "lib");
    world.Service.DidChange(LibUri, "concept x { }");

    // Edit mm so its compiled document gains a distinctive new concept.
    await world.Member("mm").Storage!.WriteText("model.todl",
        "namespace acme { concept Widget { label : string?; } concept FreshlyAdded { label : string?; } }");
    await world.RaiseReferencesChanged("mm");

    await world.Service.CompletionsAt(LibUri, Fixtures.Pos);
    const libBases = engine.BasesByUri.get(LibUri);
    assert.ok(libBases !== undefined, "lib should re-send its bases after the token bump");
    assert.ok(JSON.stringify(libBases).includes("FreshlyAdded"),
        "lib's re-sent bases must reflect mm's NEW compiled document");
});

// A1 — the producer-removed dependent case: after the base member is removed, its
// dependent's re-sent bases must no longer carry the removed member's document.
test("removing a base member refreshes its dependents' warm bases (dependent drops the removed base)", async () =>
{
    const engine = new CapturingEngine();
    const world = World.Build([
        { id: "mm", type: "meta-model", storage: Fixtures.Storage("mm", Fixtures.MetaModelFiles("mm", "1.0.0", "Widget")) },
        { id: "lib", type: "library", storage: Fixtures.Storage("lib", Fixtures.LibraryFiles("lib", "mm", "1.0.0", "Gadget", "Widget")) },
    ], engine);
    await world.Prime("mm", "lib");
    world.Service.DidChange(LibUri, "concept x { }");

    await world.Service.CompletionsAt(LibUri, Fixtures.Pos);   // warm send captures mm's document in lib's bases
    assert.ok(JSON.stringify(engine.BasesByUri.get(LibUri)).includes("Widget"));

    await world.RemoveMember("mm");

    await world.Service.CompletionsAt(LibUri, Fixtures.Pos);
    const libBases = engine.BasesByUri.get(LibUri);
    assert.ok(libBases !== undefined, "lib should re-send its bases after the token bump");
    assert.ok(!JSON.stringify(libBases).includes("Widget"),
        "after mm is removed, lib's re-sent bases must no longer contain mm's document");
});
