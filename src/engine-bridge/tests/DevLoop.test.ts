import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessScope, Cypher, EdgeDirection, GraphEngine, StorageKind, type ILinkView, type INodeView } from '@pragmatic-tech-ai/graph';
import * as EngineSurface from '@pragmatic-tech-ai/todl/engine';
import type {
    IDescribeDiagnostic,
    IDescribeOptions,
    IPolicyDiagnostic,
    IPrincipalFacts,
    ISavedModel,
    ISavedSnapshot,
    ISnapshotDescription,
    ITodlDraftSession,
    ITodlModelWorkspace,
} from '@pragmatic-tech-ai/todl/engine';
import { checkAgainst } from '../../compiler-services/api.js';
import type { Repository } from '../../compiler-services/model/model.js';
import type { TodlDocument } from '../../compiler-services/emit/json.js';
import { Domain } from '../../domain/domain.js';
import { MemoryPackageSource } from '../../domain/memory-package-source.js';
import { compilePackage, PackageKind, type PackageRef } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { TodlFileConnector } from '../TodlFileConnector.js';
import { TodlNames } from '../TodlNames.js';
import { TodlNodePlacement } from '../TodlNodePlacement.js';
import { MemoryModelWorkspace } from './MemoryModelWorkspace.js';
import { RepositoryAgreement } from './RepositoryAgreement.js';

/** Every node of the engine as the query layer reads it: the node view and its outgoing and incoming links. */
interface INodeState
{
    readonly Node: INodeView;
    /** The property names in read order (deepEqual on the Properties map alone ignores order). */
    readonly Order: readonly string[];
    readonly Out: readonly ILinkView[];
    readonly In: readonly ILinkView[];
}

/** The type names the engine subpath exports; a missing one fails typecheck. */
interface IExportedTypes
{
    readonly Diagnostic: IDescribeDiagnostic;
    readonly Options: IDescribeOptions;
    readonly Description: ISnapshotDescription;
    readonly Facts: IPrincipalFacts;
    readonly PolicyDiagnostic: IPolicyDiagnostic;
    readonly Workspace: ITodlModelWorkspace;
    readonly Session: ITodlDraftSession;
    readonly SavedModel: ISavedModel;
    readonly SavedSnapshot: ISavedSnapshot;
}

/** A shop model in a memory workspace, compiled through the package pipeline into an engine over the file connector. */
class DevLoopFx
{
    public static readonly Model = 'shop.p';
    public static readonly Namespace = 'shop';
    public static readonly Version = '1.0.0';
    public static readonly MainFile = 'main.todl';
    /** Where a node created without a home lands: `${namespace}.todl`. */
    public static readonly DefaultFile = 'shop.todl';
    public static readonly Created = 'shop.o1';
    public static readonly CreatedLocal = 'o1';
    public static readonly W0 = 'shop.w0';
    public static readonly W1 = 'shop.w1';
    public static readonly W2 = 'shop.w2';
    public static readonly L1 = 'shop.l1';
    public static readonly Name = 'name';
    public static readonly Count = 'count';
    public static readonly Weight = 'weight';
    public static readonly Parts = 'parts';
    public static readonly Kinds = 'kinds';
    public static readonly Home = 'home';
    public static readonly CreatedLabel = 'Made';
    public static readonly AuthoredCount = /count = 1;/;
    public static readonly Big = 'shop.Kinds.Big';
    /** Int64 extremes and floats whose decimal text is not a bare TODL literal (or loses its sign as String(-0)). */
    public static readonly Extremes: readonly [string, string, bigint | number][] = [
        [DevLoopFx.W0, DevLoopFx.Count, 2n ** 63n - 1n],
        [DevLoopFx.W1, DevLoopFx.Count, -(2n ** 63n)],
        [DevLoopFx.W0, DevLoopFx.Weight, 0.1],
        [DevLoopFx.W1, DevLoopFx.Weight, 1e21],
        [DevLoopFx.W2, DevLoopFx.Weight, -0],
    ];
    public static readonly Small = 'shop.Kinds.Small';
    public static readonly MintPrefix = 'o';
    public static readonly AuthoredW0 = 'name = "w0"; count = 1;';
    public static readonly EditedW0 = 'name = "w0"; count = 42;';
    public static readonly W2Line = '        Widget w2 { name = "w2"; home = l2; }\n';
    public static readonly SchemaUnchanged = 'the schema did not change';
    public static readonly NoSeedCommit = 'the seed had no data op (marking the created node seeded is no commit)';
    public static readonly CreatedRecompiled = 'the created node is in the recompiled repository';
    public static readonly QuotedCount = /count = "-3";/;
    public static readonly Shop = `namespace shop
{
    concept Loc { name : string?; }
    concept Widget
    {
        name : string?; count : integer?; weight : number?;
        kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { } term Small { } }
    model Shop : shop
    {
        Loc l1 { name = "l1"; }
        Loc l2 { name = "l2"; }
        Widget w0 { name = "w0"; count = 1; weight = 0.5; kind = Small; kinds = [Big]; home = l1; parts = [w1]; }
        Widget w1 { name = "w1"; kinds = [Small]; }
        Widget w2 { name = "w2"; home = l2; }
    }
}`;
    /** The dev write: a create with placement, sets (a label too), new links (one appended after a seeded one), and a delete. */
    public static readonly Writes = [
        "CREATE (n:shop.Widget {name: 'made'}) SET n.count = -3, n.weight = 1.0 / 10000000",
        "MATCH (n:shop.Widget {name: 'made'}) SET n.label = 'Made'",
        "MATCH (n:shop.Widget {name: 'w1'}) SET n.count = 1152921504606846976, n.weight = -2.5, n.name = 'one'",
        "MATCH (a:shop.Widget {name: 'w0'}), (b:shop.Widget {name: 'made'}) CREATE (a)-[:parts]->(b)",
        "MATCH (a:shop.Widget {name: 'w0'}), (:shop.Widget {name: 'one'})-[:kinds]->(t) CREATE (a)-[:kinds]->(t)",
        "MATCH (b:shop.Widget {name: 'made'}), (l:shop.Loc {name: 'l2'}) CREATE (b)-[:home]->(l)",
        "MATCH (n:shop.Widget {name: 'w2'}) DETACH DELETE n",
    ];

    public static Workspace(): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        workspace.Add(DevLoopFx.Model, DevLoopFx.Namespace, { [DevLoopFx.MainFile]: DevLoopFx.Shop });
        return workspace;
    }

    /**
     * Recompiles the workspace's `models` (each over the earlier ones) from their current files through compilePackage,
     * loads the last into a Domain and describes its snapshot with the file connector as the default.
     */
    public static async Describe(workspace: MemoryModelWorkspace, models: readonly string[] = [DevLoopFx.Model]): Promise<ISnapshotDescription>
    {
        const store = new MemoryPackageSource();
        const bases: TodlDocument[] = [];
        const dependencies: PackageRef[] = [];
        for (const model of models)
        {
            const out = compilePackage(bases, workspace.Sources(model), { id: model, version: DevLoopFx.Version }, [...dependencies]);
            assert.ok(out.ok, JSON.stringify(out.errors));
            store.Add(PackageManifestBridge.toResolved(out.package!));
            bases.push(out.package!.fullDocument);
            dependencies.push({ kind: PackageKind.Architecture, id: model, version: DevLoopFx.Version });
        }
        const domain = new Domain(store);
        await domain.load({ model: models[models.length - 1]!, version: DevLoopFx.Version });
        const described = SnapshotDescriber.Describe(domain.Snapshot, { DefaultConnector: TodlNames.FileConnector });
        assert.deepEqual(described.Diagnostics, []);
        return described;
    }

    /** The model's repository as its current files compile. */
    public static Repository(workspace: MemoryModelWorkspace, model: string = DevLoopFx.Model): Repository
    {
        return checkAgainst([], workspace.Sources(model)).model;
    }

    public static async Open(connector: TodlFileConnector, description: ISnapshotDescription): Promise<GraphEngine>
    {
        return GraphEngine.Open({ Description: description.Description, Storage: { Kind: StorageKind.Memory }, Connectors: [connector] });
    }

    /** Runs the dev write through Cypher, placing created nodes in the shop model as `shop.o1`, `shop.o2`, .... */
    public static async Write(engine: GraphEngine, queries: readonly string[] = DevLoopFx.Writes): Promise<void>
    {
        let minted = 0;
        const placement = new TodlNodePlacement(DevLoopFx.Model, DevLoopFx.Namespace, { next: () => DevLoopFx.MintPrefix + String(++minted) });
        const cypher = new Cypher.CypherEngine(engine);
        for (const query of queries)
        {
            await cypher.Execute(AccessScope.System, query, { Placement: placement });
        }
    }

    /** Every node (todl.Element closure, terms included) with its view and links, keyed and ordered by public id. */
    public static async State(engine: GraphEngine): Promise<Map<string, INodeState>>
    {
        const reader = await engine.BeginRead(AccessScope.System);
        try
        {
            const ids: string[] = [];
            for await (const id of reader.ScanNodes(TodlNames.Element)) ids.push(id);
            const state = new Map<string, INodeState>();
            for (const id of ids.sort())
            {
                const node = (await reader.ReadNode(id))!;
                state.set(id, {
                    Node: node,
                    Order: [...node.Properties.keys()],
                    Out: await reader.Links(id, EdgeDirection.Out),
                    In: await reader.Links(id, EdgeDirection.In),
                });
            }
            return state;
        }
        finally
        {
            reader.dispose();
        }
    }

    public static async IsSeeded(engine: GraphEngine, id: string): Promise<boolean>
    {
        const reader = await engine.BeginRead(AccessScope.System);
        try
        {
            return await reader.IsSeeded(id);
        }
        finally
        {
            reader.dispose();
        }
    }

    public static Targets(state: Map<string, INodeState>, id: string, relationship: string): string[]
    {
        return state.get(id)!.Out.filter((l) => l.Relationship === relationship).map((l) => l.PublicId);
    }
}

/** Two packages sharing the `shop` namespace, the app over the lib, so an instance can move between them by id. */
class MoveFx
{
    public static readonly Lib = 'lib.p';
    public static readonly App = 'app.p';
    public static readonly LibFile = 'lib.todl';
    public static readonly AppFile = 'app.todl';
    public static readonly Moving = 'shop.m';
    public static readonly Staying = 'shop.s';
    public static readonly LibText = `namespace shop
{
    concept Widget { name : string?; relationship parts -> Widget[]; }
    model Lib : shop
    {
        Widget s { name = "s"; }
        Widget m { name = "m"; parts = [s]; }
    }
}`;
    public static readonly AppText = 'namespace shop { model App : shop { } }';
    public static readonly LibMoved = MoveFx.LibText.replace('        Widget m { name = "m"; parts = [s]; }\n', '');
    public static readonly AppMoved = 'namespace shop { model App : shop { Widget m { name = "m"; parts = [s]; } } }';
    /** A write to the moved node after the upgrade: routed by its new owner, it lands in the app's file. */
    public static readonly Rename = "MATCH (n:shop.Widget {name: 'm'}) SET n.name = 'moved'";
    public static readonly Renamed = /name = "moved";/;
    public static readonly OnlyOwnerChanged = 'the whole node state but the owner is unchanged';

    public static Workspace(): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        workspace.Add(MoveFx.Lib, DevLoopFx.Namespace, { [MoveFx.LibFile]: MoveFx.LibText });
        workspace.Add(MoveFx.App, DevLoopFx.Namespace, { [MoveFx.AppFile]: MoveFx.AppText });
        return workspace;
    }
}

/** The runtime names `@pragmatic-tech-ai/todl/engine` exports. */
class ExportSurface
{
    public static readonly Expected = [
        'CellConverter',
        'DescribeDiagnosticCode',
        'EngineBridgeError',
        'EngineBridgeErrorCode',
        'EngineCellMapper',
        'ExternalIdentity',
        'ExternalValues',
        'PolicyDiagnosticCode',
        'PolicyScopeCompiler',
        'SavedModelCompiler',
        'SnapshotDescriber',
        'TodlFileConnector',
        // Reserved schema names a host needs: FileConnector for IDescribeOptions.DefaultConnector, Label / Class /
        // Term / Element for Cypher over the described schema.
        'TodlNames',
        'TodlNodePlacement',
    ];
}

describe('dev loop end to end', () =>
{
    test('write, recompile, upgrade is a data no-op', async () =>
    {
        const workspace = DevLoopFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const engine = await DevLoopFx.Open(connector, await DevLoopFx.Describe(workspace));
        try
        {
            await DevLoopFx.Write(engine);
            const written = await DevLoopFx.State(engine);
            // The write did what it says before the recompile, so the comparison below is not vacuous.
            assert.equal(written.has(DevLoopFx.W2), false);
            assert.equal(written.get(DevLoopFx.Created)!.Node.Owner, DevLoopFx.Model);
            assert.equal(written.get(DevLoopFx.Created)!.Node.Properties.get(TodlNames.Label), DevLoopFx.CreatedLabel);
            assert.equal(written.get(DevLoopFx.W1)!.Node.Properties.get(DevLoopFx.Count), 2n ** 60n);
            assert.equal(written.get(DevLoopFx.Created)!.Node.Properties.get(DevLoopFx.Count), -3n);
            assert.equal(written.get(DevLoopFx.Created)!.Node.Properties.get(DevLoopFx.Weight), 1e-7);
            assert.deepEqual(DevLoopFx.Targets(written, DevLoopFx.W0, DevLoopFx.Parts), [DevLoopFx.W1, DevLoopFx.Created]);
            assert.deepEqual(DevLoopFx.Targets(written, DevLoopFx.W0, DevLoopFx.Kinds), [DevLoopFx.Big, DevLoopFx.Small]);
            assert.equal(await DevLoopFx.IsSeeded(engine, DevLoopFx.Created), false);
            // The re-emitted file keeps the author's numeric literals bare; numbers TODL has no bare literal for are quoted.
            assert.match(workspace.Files.get(DevLoopFx.MainFile)!, DevLoopFx.AuthoredCount);
            assert.match(workspace.Files.get(DevLoopFx.DefaultFile)!, DevLoopFx.QuotedCount);

            const upgrade = await engine.Upgrade((await DevLoopFx.Describe(workspace)).Description);
            assert.equal(upgrade.Changed, false, DevLoopFx.SchemaUnchanged);
            assert.equal(upgrade.SeedCommit, undefined, DevLoopFx.NoSeedCommit);
            assert.deepEqual(await DevLoopFx.State(engine), written);
            assert.equal(await DevLoopFx.IsSeeded(engine, DevLoopFx.Created), true);
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('numeric extremes round-trip through the files', async () =>
    {
        const workspace = DevLoopFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const engine = await DevLoopFx.Open(connector, await DevLoopFx.Describe(workspace));
        try
        {
            const txn = await engine.Begin(AccessScope.System);
            try
            {
                for (const [id, member, value] of DevLoopFx.Extremes) txn.SetProperty(id, member, value);
                await txn.Commit();
            }
            finally
            {
                txn.dispose();
            }
            const written = await DevLoopFx.State(engine);
            await engine.Upgrade((await DevLoopFx.Describe(workspace)).Description);
            const state = await DevLoopFx.State(engine);
            assert.deepEqual(state, written);
            for (const [id, member, value] of DevLoopFx.Extremes)
            {
                const back = state.get(id)!.Node.Properties.get(member);
                assert.ok(Object.is(back, value), `${id}.${member}: ${String(value)} came back as ${String(back)}`);
            }
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('edited file upgrades the engine', async () =>
    {
        const workspace = DevLoopFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const engine = await DevLoopFx.Open(connector, await DevLoopFx.Describe(workspace));
        try
        {
            const edited = DevLoopFx.Shop
                .replace(DevLoopFx.AuthoredW0, DevLoopFx.EditedW0)
                .replace(DevLoopFx.W2Line, '');
            assert.notEqual(edited, DevLoopFx.Shop);
            workspace.Files.set(DevLoopFx.MainFile, edited);
            await engine.Upgrade((await DevLoopFx.Describe(workspace)).Description);
            const state = await DevLoopFx.State(engine);
            assert.equal(state.get(DevLoopFx.W0)!.Node.Properties.get(DevLoopFx.Count), 42n);
            assert.equal(state.has(DevLoopFx.W2), false);
            assert.ok(state.has(DevLoopFx.W1));
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('engine agrees with repository after a write', async () =>
    {
        const workspace = DevLoopFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const engine = await DevLoopFx.Open(connector, await DevLoopFx.Describe(workspace));
        try
        {
            await DevLoopFx.Write(engine);
            await engine.Upgrade((await DevLoopFx.Describe(workspace)).Description);
            const repo = DevLoopFx.Repository(workspace);
            assert.ok(repo.has(DevLoopFx.Created), DevLoopFx.CreatedRecompiled);
            const counts = await RepositoryAgreement.Compare(engine, repo, DevLoopFx.Model);
            assert.ok(counts.Instances >= 4 && counts.IsAPairs > 0, JSON.stringify(counts));
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('an instance moved between packages is re-owned on upgrade', async () =>
    {
        const workspace = MoveFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const models = [MoveFx.Lib, MoveFx.App];
        const engine = await DevLoopFx.Open(connector, await DevLoopFx.Describe(workspace, models));
        try
        {
            const before = await DevLoopFx.State(engine);
            assert.equal(before.get(MoveFx.Moving)!.Node.Owner, MoveFx.Lib);
            workspace.Files.set(MoveFx.LibFile, MoveFx.LibMoved);
            workspace.Files.set(MoveFx.AppFile, MoveFx.AppMoved);
            await engine.Upgrade((await DevLoopFx.Describe(workspace, models)).Description);
            const after = await DevLoopFx.State(engine);
            const moved = after.get(MoveFx.Moving)!;
            assert.equal(moved.Node.Owner, MoveFx.App);
            const was = before.get(MoveFx.Moving)!;
            assert.deepEqual({ ...moved, Node: { ...moved.Node, Owner: MoveFx.Lib } }, was, MoveFx.OnlyOwnerChanged);
            // deepEqual on the Properties Map ignores key order; the read order is compared explicitly.
            assert.deepEqual(moved.Order, was.Order, MoveFx.OnlyOwnerChanged);
            assert.equal(after.get(MoveFx.Staying)!.Node.Owner, MoveFx.Lib);
            assert.equal(await DevLoopFx.IsSeeded(engine, MoveFx.Moving), true);
            await DevLoopFx.Write(engine, [MoveFx.Rename]);
            assert.match(workspace.Files.get(MoveFx.AppFile)!, MoveFx.Renamed);
            assert.equal(workspace.Files.get(MoveFx.LibFile), MoveFx.LibMoved);
        }
        finally
        {
            await engine.dispose();
        }
    });
});

describe('engine subpath export surface', () =>
{
    test('exports exactly the bridge surface', () =>
    {
        assert.deepEqual(Object.keys(EngineSurface).sort(), [...ExportSurface.Expected].sort());
        // The type exports are pinned by IExportedTypes above: typecheck fails when one is dropped.
    });
});
