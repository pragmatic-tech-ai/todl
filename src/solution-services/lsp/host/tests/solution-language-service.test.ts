import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { Position } from "vscode-languageserver-types";
import { SolutionLanguageService } from "../solution-language-service.js";
import { AnalysisEngineKey, type IAnalysisEngine } from "../i-analysis-engine.js";
import { AnalyzeKind, type AnalyzeRequest, type AnalyzeResponse } from "../../analysis/protocol.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";
import { SolutionBaseResolver } from "../../../solution-manager/engine/solution-base-resolver.js";
import type { IBaseResolver } from "../../../solution-manager/engine/i-base-resolver.js";
import { PackageStoreKey } from "../../../todl-build-system/package-store.js";
import type { SourcedPackage } from "../../../todl-build-system/package-source.js";
import { ProjectEvents, ProjectEventsKey, ProjectEventKind } from "../../../project-services/generators/project-events.js";
import type { PackageRef } from "../../../../publish/publish.js";

// Fixtures over a real Solution + a real SolutionBaseResolver (resolved by the
// service), mirroring the Task-3 / Task-11 tests. Static helpers on a class — no
// free functions.
class Fixtures
{
    private static readonly ConsumerRoot = "file:///solution/consumer";
    public static readonly ConsumerUri = "file:///solution/consumer/model.todl";
    public static readonly OutsideUri = "file:///outside/x.todl";
    public static readonly Pos: Position = { line: 0, character: 11 };
    public static readonly Edit = "concept foo { }";
    private static readonly ConsumerId = "landscape";
    private static readonly ModelFileName = "model.todl";
    private static readonly MemberType = "library";

    // A consumer project with a manifest that binds nothing, so ResolveBasesFor
    // returns an empty (but real) warm base-set.
    public static ConsumerStorage(): IStorage
    {
        const manifest: ProjectManifest = { type: ProjectType.Library, name: Fixtures.ConsumerId, version: 1, id: Fixtures.ConsumerId };
        const storage = new FakeStorage(Fixtures.ConsumerRoot);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(Fixtures.ModelFileName, "namespace lib { }");
        return storage;
    }

    // A ServiceProvider carrying a manager stub whose ActiveSolution is a real
    // Solution with one member rooted at the consumer storage. An optional engine
    // double is registered under AnalysisEngineKey.
    public static Provider(engine?: IAnalysisEngine): ServiceProvider
    {
        const solution = new Solution("S");
        const member = solution.AddMember(Fixtures.ConsumerId, Fixtures.MemberType);
        member.Storage = Fixtures.ConsumerStorage();
        const manager = { ActiveSolution: solution };
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService);
        if (engine !== undefined) provider.registerInstance(AnalysisEngineKey, engine);
        return provider;
    }
}

// Records whether each request carried Context.Bases, so the base-set gating can
// be asserted directly.
class SpyEngine implements IAnalysisEngine
{
    public readonly BasesSeen: boolean[] = [];

    public async Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>
    {
        this.BasesSeen.push(request.Context.Bases !== undefined);
        return { Kind: AnalyzeKind.Completion, Items: [] };
    }
}

test("CompletionsAt returns the engine result for an in-project document after DidChange", async () =>
{
    const svc = new SolutionLanguageService(Fixtures.Provider());
    svc.DidChange(Fixtures.ConsumerUri, Fixtures.Edit);

    const items = await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);
    assert.ok(Array.isArray(items));

    const hover = await svc.HoverAt(Fixtures.ConsumerUri, Fixtures.Pos);
    assert.ok(hover === null || typeof hover === "object");
});

test("a request for a URI under no project root returns empty, does not throw", async () =>
{
    const svc = new SolutionLanguageService(Fixtures.Provider());
    assert.deepEqual(await svc.CompletionsAt(Fixtures.OutsideUri, Fixtures.Pos), []);
    assert.equal(await svc.HoverAt(Fixtures.OutsideUri, Fixtures.Pos), null);
});

test("the full base-set is sent when the project changed, then suppressed on the next same request", async () =>
{
    const spy = new SpyEngine();
    const svc = new SolutionLanguageService(Fixtures.Provider(spy));
    svc.DidChange(Fixtures.ConsumerUri, Fixtures.Edit);

    await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);
    await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);

    assert.deepEqual(spy.BasesSeen, [true, false]);
});

// A solution with an UNPUBLISHED producer (meta-model "mm") and a consumer library
// ("lib") binding it, over a shared resolver + project-event bus, so the service's
// base-resolution facade can be compared to the owned resolver.
class BaseWorld
{
    public static readonly ProducerId = "mm";
    public static readonly ConsumerId = "lib";
    public static readonly ProducerVersion = "1.0.0";
    public static readonly StaleMembersProperty = "StaleMembers";
    private static readonly RootPrefix = "file:///solution/";

    public readonly Producer: IStorage;
    public readonly Consumer: IStorage;
    public readonly Resolver: SolutionBaseResolver;
    public readonly Events = new ProjectEvents();
    public readonly Service: SolutionLanguageService;

    constructor()
    {
        const producerManifest: ProjectManifest = { type: ProjectType.MetaModel, name: BaseWorld.ProducerId, version: 1, id: BaseWorld.ProducerId, packageVersion: BaseWorld.ProducerVersion };
        const consumerManifest: ProjectManifest = {
            type: ProjectType.Library, name: BaseWorld.ConsumerId, version: 1, id: BaseWorld.ConsumerId, packageVersion: BaseWorld.ProducerVersion,
            metaModels: [{ id: BaseWorld.ProducerId, version: BaseWorld.ProducerVersion }],
        };
        this.Producer = BaseWorld.Storage(BaseWorld.ProducerId, producerManifest, "namespace acme { concept Widget { label : string?; } }");
        this.Consumer = BaseWorld.Storage(BaseWorld.ConsumerId, consumerManifest, "namespace lib { concept Gadget : acme.Widget { } }");
        const solution = new Solution("S");
        solution.AddMember(BaseWorld.ProducerId, "meta-model").Storage = this.Producer;
        solution.AddMember(BaseWorld.ConsumerId, "library").Storage = this.Consumer;
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: solution } as unknown as SolutionManagerService);
        provider.registerInstance(PackageStoreKey, { TryGet(): Promise<SourcedPackage | undefined> { return Promise.resolve(undefined); } } as never);
        this.Resolver = new SolutionBaseResolver(provider);
        provider.registerInstance(SolutionBaseResolver.Key, this.Resolver);
        provider.registerInstance(ProjectEventsKey, this.Events);
        this.Service = new SolutionLanguageService(provider);
    }

    private static Storage(id: string, manifest: ProjectManifest, source: string): IStorage
    {
        const storage = new FakeStorage(`${BaseWorld.RootPrefix}${id}`);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText("model.todl", source);
        return storage;
    }

    // Prime the resolver's compile cache + dependency graph so Invalidate can evict dependents.
    public async Prime(): Promise<void>
    {
        for (const id of [BaseWorld.ProducerId, BaseWorld.ConsumerId])
        {
            await this.Resolver.TryGet({ id, version: BaseWorld.ProducerVersion } as PackageRef);
        }
    }
}

test("ResolveBasesFor returns the producer's bases, identical to the owned resolver", async () =>
{
    const world = new BaseWorld();
    const viaService = await world.Service.ResolveBasesFor(world.Consumer);
    const viaResolver = await world.Resolver.ResolveBasesFor(world.Consumer);

    assert.ok(viaService.bases.length > 0);
    assert.deepEqual(viaService.bases, viaResolver.bases);
    assert.deepEqual(viaService.problems, viaResolver.problems);
    assert.deepEqual([...viaService.originOf], [...viaResolver.originOf]);
});

test("ProducedIdOf returns the producer's id and WorkspaceProducers lists it", async () =>
{
    const world = new BaseWorld();
    assert.equal(await world.Service.ProducedIdOf(world.Producer), BaseWorld.ProducerId);
    assert.deepEqual(await world.Service.WorkspaceProducers(ProjectType.MetaModel), [{ id: BaseWorld.ProducerId, version: BaseWorld.ProducerVersion }]);
    assert.deepEqual([...(await world.Service.ReferencedPublishedRefs(world.Consumer))], [`${BaseWorld.ProducerId}@${BaseWorld.ProducerVersion}`]);
});

test("typed as IBaseResolver, the service delegates ConsumerIdOf and Invalidate to the owned resolver", async () =>
{
    const world = new BaseWorld();
    await world.Prime();
    const resolver: IBaseResolver = world.Service;

    assert.equal(await resolver.ConsumerIdOf(world.Producer), BaseWorld.ProducerId);

    resolver.Invalidate(BaseWorld.ProducerId);
    assert.ok(world.Service.StaleMembers.has(BaseWorld.ProducerId));
    assert.ok(world.Service.StaleMembers.has(BaseWorld.ConsumerId));
});

test("StaleMembers raises PropertyChanged on producer edit and holds the dependent consumer id", async () =>
{
    const world = new BaseWorld();
    await world.Prime();
    let raised = 0;
    const sub = world.Service.PropertyChanged(BaseWorld.StaleMembersProperty).subscribe(() => { raised += 1; });

    await world.Events.Raise({
        Kind: ProjectEventKind.ReferencesChanged,
        ProjectType: ProjectType.MetaModel,
        Project: world.Producer,
        Manifest: JSON.parse(await world.Producer.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifest,
    });

    assert.ok(raised > 0);
    assert.ok(world.Service.StaleMembers.has(BaseWorld.ConsumerId));
    assert.ok(world.Service.StaleMembers.has(BaseWorld.ProducerId));
    sub.dispose();
});
