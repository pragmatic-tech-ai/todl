import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AccessScope,
    ConnectorChangeSet,
    ConnectorError,
    DateValue,
    GraphEngine,
    StorageKind,
    WriteOp,
    type CellValue,
    type ConnectorChange,
    type IConnectorTransaction,
} from '@pragmatic-tech-ai/graph';
import { ModelDraft } from '../../authoring/model-draft.js';
import { Severity } from '../../compiler-services/diagnostics/diagnostic.js';
import { Domain } from '../../domain/domain.js';
import { MemoryPackageSource } from '../../domain/memory-package-source.js';
import { compilePackage } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { TodlFileConnector } from '../TodlFileConnector.js';
import { TodlNames } from '../TodlNames.js';
import { TodlNodePlacement } from '../TodlNodePlacement.js';
import { MemoryModelWorkspace } from './MemoryModelWorkspace.js';

/** The shop model in a memory workspace, change builders, and re-parsing of what the connector wrote. */
class ConnectorFx
{
    public static readonly Model = 'shop.p';
    public static readonly Namespace = 'shop';
    public static readonly Version = '1.0.0';
    public static readonly MainFile = 'main.todl';
    /** Where a node created without a home lands: `${namespace}.todl`. */
    public static readonly DefaultFile = 'shop.todl';
    public static readonly Widget = 'shop.Widget';
    public static readonly Loc = 'shop.Loc';
    public static readonly Big = 'shop.Kinds.Big';
    public static readonly Small = 'shop.Kinds.Small';
    public static readonly Shop = `namespace shop
{
    concept Loc { }
    concept Widget
    {
        name : string?; count : integer?; weight : number?;
        kind : Kinds?; kinds : Kinds[]; home : Loc?;
        relationship parts -> Widget[];
    }
    taxonomy Kinds : represents Widget { term Big { } term Small { } }
    model Shop : shop
    {
        Loc l1 { }
        Loc l2 { }
        Widget w0 { name = "w"; kind = Small; kinds = [Big]; home = l1; }
        Widget w1 { }
    }
}`;

    public static Workspace(): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        workspace.Add(ConnectorFx.Model, ConnectorFx.Namespace, { [ConnectorFx.MainFile]: ConnectorFx.Shop });
        return workspace;
    }

    public static Create(id: string, concept: string, owner: string = ConnectorFx.Model): ConnectorChange
    {
        return { Op: WriteOp.CreateNode, PublicId: id, Concept: concept, Owner: owner };
    }

    public static Set(id: string, member: string, value: CellValue, concept: string = ConnectorFx.Widget, owner: string = ConnectorFx.Model): ConnectorChange
    {
        return { Op: WriteOp.SetProperty, PublicId: id, Member: member, Value: value, Concept: concept, Owner: owner };
    }

    public static Link(from: string, relationship: string, to: string): ConnectorChange
    {
        return { Op: WriteOp.Link, From: from, Relationship: relationship, To: to, Concept: ConnectorFx.Widget, Owner: ConnectorFx.Model };
    }

    public static Unlink(from: string, relationship: string, to: string): ConnectorChange
    {
        return { Op: WriteOp.Unlink, From: from, Relationship: relationship, To: to, Concept: ConnectorFx.Widget, Owner: ConnectorFx.Model };
    }

    public static Delete(id: string, concept: string): ConnectorChange
    {
        return { Op: WriteOp.DeleteNode, PublicId: id, Concept: concept, Owner: ConnectorFx.Model };
    }

    public static async Applied(connector: TodlFileConnector, changes: readonly ConnectorChange[]): Promise<IConnectorTransaction>
    {
        const txn = await connector.Begin();
        await txn.Apply(new ConnectorChangeSet(changes));
        return txn;
    }

    /** The model as the workspace's files now hold it, re-parsed. */
    public static Reparsed(workspace: MemoryModelWorkspace, uris: readonly string[] = [ConnectorFx.MainFile, ConnectorFx.DefaultFile]): ModelDraft
    {
        const sources = uris.filter((u) => workspace.Files.has(u)).map((uri) => ({ uri, text: workspace.Files.get(uri)! }));
        return ModelDraft.fromSources([], sources, { namespace: ConnectorFx.Namespace });
    }

    public static Attrs(draft: ModelDraft, id: string): Record<string, unknown> | undefined
    {
        const node = draft.toJSON().nodes.find((n) => n.id === id);
        return node === undefined ? undefined : { type: node.type, ...(node.attrs as Record<string, unknown>) };
    }

    public static Refs(draft: ModelDraft, id: string, member: string): string[]
    {
        return draft.toJSON().edges.filter((e) => e.from === id && e.via === member).map((e) => String(e.to)).sort();
    }

    public static async Rejection(work: Promise<unknown>): Promise<unknown>
    {
        try
        {
            await work;
        }
        catch (error)
        {
            return error;
        }
        assert.fail('expected a rejection');
    }

    public static AssertBridge(error: unknown, code: EngineBridgeErrorCode): void
    {
        assert.ok(error instanceof EngineBridgeError, String(error));
        assert.equal(error.Code, code, error.message);
    }

    /** The shop package compiled and loaded, described with the file connector as the default. */
    public static async Engine(connector: TodlFileConnector): Promise<GraphEngine>
    {
        const store = new MemoryPackageSource();
        const out = compilePackage([], [{ uri: ConnectorFx.MainFile, text: ConnectorFx.Shop }], { id: ConnectorFx.Model, version: ConnectorFx.Version });
        assert.ok(out.ok, JSON.stringify(out.errors));
        store.Add(PackageManifestBridge.toResolved(out.package!));
        const domain = new Domain(store);
        await domain.load({ model: ConnectorFx.Model, version: ConnectorFx.Version });
        const { Description } = SnapshotDescriber.Describe(domain.graph, { DefaultConnector: TodlNames.FileConnector });
        return GraphEngine.Open({ Description, Storage: { Kind: StorageKind.Memory }, Connectors: [connector] });
    }
}

describe('TodlFileConnector', () =>
{
    test('takes the file connector name', () =>
    {
        assert.equal(TodlFileConnector.ConnectorName, TodlNames.FileConnector);
        assert.equal(new TodlFileConnector(ConnectorFx.Workspace()).Name, TodlNames.FileConnector);
    });

    test('create, set, link, delete reach the file', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Create('shop.w2', ConnectorFx.Widget),
            ConnectorFx.Set('shop.w2', 'name', 'two'),
            ConnectorFx.Set('shop.w2', 'count', 5n),
            ConnectorFx.Set('shop.w2', 'weight', 2.5),
            ConnectorFx.Set('shop.w2', TodlNames.Label, 'Two'),
            ConnectorFx.Set('shop.w2', 'kind', ConnectorFx.Big),
            ConnectorFx.Link('shop.w2', 'kinds', ConnectorFx.Small),
            ConnectorFx.Link('shop.w2', 'home', 'shop.l1'),
            ConnectorFx.Link('shop.w0', 'parts', 'shop.w2'),
            ConnectorFx.Set('shop.w0', 'kind', ConnectorFx.Big),
            ConnectorFx.Unlink('shop.w0', 'kinds', ConnectorFx.Big),
            ConnectorFx.Delete('shop.l2', ConnectorFx.Loc),
        ]);
        await txn.Commit();
        const draft = ConnectorFx.Reparsed(workspace);
        assert.deepEqual(draft.diagnostics.filter((d) => d.severity === Severity.Error), []);
        // TODL keeps numeric literals as decimal strings once parsed.
        assert.deepEqual(ConnectorFx.Attrs(draft, 'shop.w2'), { type: ConnectorFx.Widget, name: 'two', count: '5', weight: '2.5', label: 'Two' });
        assert.match(workspace.Files.get(ConnectorFx.DefaultFile)!, /count = 5;/);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w2', 'kind'), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w2', 'kinds'), [ConnectorFx.Small]);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w2', 'home'), ['shop.l1']);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w0', 'parts'), ['shop.w2']);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w0', 'kind'), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w0', 'kinds'), []);
        assert.equal(ConnectorFx.Attrs(draft, 'shop.l2'), undefined);
        assert.deepEqual(ConnectorFx.Attrs(draft, 'shop.w0'), { type: ConnectorFx.Widget, name: 'w' });
    });

    test('null removes field', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const first = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', TodlNames.Label, 'One')]);
        await first.Commit();
        assert.equal(ConnectorFx.Attrs(ConnectorFx.Reparsed(workspace), 'shop.w1')?.label, 'One');
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set('shop.w0', 'name', null),
            ConnectorFx.Set('shop.w0', 'kind', null),
            ConnectorFx.Set('shop.w1', TodlNames.Label, null),
        ]);
        await txn.Commit();
        const draft = ConnectorFx.Reparsed(workspace);
        assert.deepEqual(ConnectorFx.Attrs(draft, 'shop.w0'), { type: ConnectorFx.Widget });
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w0', 'kind'), []);
        assert.deepEqual(ConnectorFx.Refs(draft, 'shop.w0', 'kinds'), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Attrs(draft, 'shop.w1'), { type: ConnectorFx.Widget });
    });

    test('foreign id rejected', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        for (const id of ['other.w9', 'w9', 'shop.', 'shop.a.b'])
        {
            const txn = await connector.Begin();
            ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([ConnectorFx.Create(id, ConnectorFx.Widget)]))), EngineBridgeErrorCode.ForeignId);
            await txn.Revert();
        }
    });

    test('unsupported values rejected', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        const values: [string, CellValue][] = [
            ['count', 2n ** 60n],
            ['count', new DateValue(3)],
            ['weight', Number.NaN],
            [TodlNames.Class, ConnectorFx.Big],
        ];
        for (const [member, value] of values)
        {
            const txn = await connector.Begin();
            ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([ConnectorFx.Set('shop.w0', member, value)]))), EngineBridgeErrorCode.UnsupportedValue);
            await txn.Revert();
        }
    });

    test('non-editable model rejected', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await connector.Begin();
        const change = ConnectorFx.Set('lib.x', 'name', 'n', ConnectorFx.Widget, 'lib.p');
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([change]))), EngineBridgeErrorCode.NotEditable);
        await txn.Revert();
        const writes = [
            ConnectorFx.Set('shop.nope', 'name', 'n'),
            ConnectorFx.Set('shop.nope', 'kind', null),
            ConnectorFx.Unlink('shop.nope', 'kinds', ConnectorFx.Big),
            ConnectorFx.Link('shop.w0', 'parts', 'shop.nope'),
            ConnectorFx.Delete('shop.nope', ConnectorFx.Widget),
            ConnectorFx.Delete(ConnectorFx.Big, ConnectorFx.Widget),
            ConnectorFx.Create('shop.w1', ConnectorFx.Widget),
        ];
        for (const write of writes)
        {
            const unowned = await connector.Begin();
            ConnectorFx.AssertBridge(await ConnectorFx.Rejection(unowned.Apply(new ConnectorChangeSet([write]))), EngineBridgeErrorCode.NotEditable);
            await unowned.Revert();
        }
        assert.deepEqual(workspace.Log, []);
    });

    test('stale sources fail commit', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', 'name', 'mine')]);
        const external = ConnectorFx.Shop.replace('Widget w1 { }', 'Widget w1 { name = "theirs"; }');
        workspace.Files.set(ConnectorFx.MainFile, external);
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.Stale);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), external);
        assert.deepEqual(workspace.Log, []);
        await txn.Revert();
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), external);
    });

    test('revert before commit drops the sessions', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', 'name', 'dropped')]);
        await txn.Revert();
        assert.deepEqual(workspace.Log, []);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        const next = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', 'name', 'kept')]);
        await next.Commit();
        assert.equal(ConnectorFx.Attrs(ConnectorFx.Reparsed(workspace), 'shop.w1')?.name, 'kept');
    });

    test('revert after commit restores originals', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set('shop.w1', 'name', 'changed'),
            ConnectorFx.Create('shop.w5', ConnectorFx.Widget),
        ]);
        await txn.Commit();
        assert.ok(workspace.Files.has(ConnectorFx.DefaultFile), 'the commit created the default file');
        assert.notEqual(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        await txn.Revert();
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        assert.deepEqual(workspace.Log.slice(-2), [`${MemoryModelWorkspace.DeleteVerb}${ConnectorFx.DefaultFile}`, `${MemoryModelWorkspace.WriteVerb}${ConnectorFx.MainFile}`]);
    });

    test('revert after commit does not overwrite a later write', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', 'name', 'changed')]);
        await txn.Commit();
        const later = workspace.Files.get(ConnectorFx.MainFile)! + '\n';
        workspace.Files.set(ConnectorFx.MainFile, later);
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Revert()), EngineBridgeErrorCode.PersistFailed);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), later);
    });

    test('partial write failure restores', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set('shop.w1', 'name', 'changed'),
            ConnectorFx.Create('shop.w5', ConnectorFx.Widget),
        ]);
        workspace.FailWriteAt = 2;
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        await txn.Revert();
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
    });

    test('several models commit in owner-name order', async () =>
    {
        const workspace = new MemoryModelWorkspace();
        const alpha = 'namespace alpha { concept Box { name : string?; } model A : alpha { Box b { } } }';
        const beta = 'namespace beta { concept Box { name : string?; } model B : beta { Box b { } } }';
        workspace.Add('beta.p', 'beta', { 'beta.todl': beta });
        workspace.Add('alpha.p', 'alpha', { 'alpha.todl': alpha });
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set('beta.b', 'name', 'B', 'beta.Box', 'beta.p'),
            ConnectorFx.Set('alpha.b', 'name', 'A', 'alpha.Box', 'alpha.p'),
        ]);
        await txn.Commit();
        assert.deepEqual(workspace.Log, [`${MemoryModelWorkspace.WriteVerb}alpha.todl`, `${MemoryModelWorkspace.WriteVerb}beta.todl`]);
        assert.match(workspace.Files.get('alpha.todl')!, /name = "A"/);
        assert.match(workspace.Files.get('beta.todl')!, /name = "B"/);
    });

    test('a commit waits for the in-flight commit of its model, then sees it stale', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const first = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w0', 'name', 'first')]);
        const second = await ConnectorFx.Applied(connector, [ConnectorFx.Set('shop.w1', 'name', 'second')]);
        let release: () => void = () => undefined;
        workspace.Gate = new Promise<void>((resolve) => { release = resolve; });
        const committed = first.Commit();
        let settled = false;
        const rejected = ConnectorFx.Rejection(second.Commit().finally(() => { settled = true; }));
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        assert.equal(settled, false, 'the second commit must not check or write while the first is writing');
        release();
        await committed;
        ConnectorFx.AssertBridge(await rejected, EngineBridgeErrorCode.Stale);
        const draft = ConnectorFx.Reparsed(workspace);
        assert.equal(ConnectorFx.Attrs(draft, 'shop.w0')?.name, 'first');
        assert.equal(ConnectorFx.Attrs(draft, 'shop.w1')?.name, undefined);
    });

    test('a later model failing restores the earlier ones', async () =>
    {
        const workspace = new MemoryModelWorkspace();
        const alpha = 'namespace alpha { concept Box { name : string?; } model A : alpha { Box b { } } }';
        const beta = 'namespace beta { concept Box { name : string?; } model B : beta { Box b { } } }';
        workspace.Add('alpha.p', 'alpha', { 'alpha.todl': alpha });
        workspace.Add('beta.p', 'beta', { 'beta.todl': beta });
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set('alpha.b', 'name', 'A', 'alpha.Box', 'alpha.p'),
            ConnectorFx.Set('beta.b', 'name', 'B', 'beta.Box', 'beta.p'),
        ]);
        workspace.Files.set('beta.todl', beta + '\n');
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.Stale);
        assert.equal(workspace.Files.get('alpha.todl'), alpha);
        assert.equal(workspace.Files.get('beta.todl'), beta + '\n');
    });

    test('concurrent writes to one model: second is stale', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const engine = await ConnectorFx.Engine(connector);
        try
        {
            let release: () => void = () => undefined;
            workspace.Gate = new Promise<void>((resolve) => { release = resolve; });
            // Both transactions have opened their sessions (Apply) before the first one's write lands.
            workspace.OnOpen = (opened) => { if (opened === 2) release(); };
            const first = await engine.Begin(AccessScope.System);
            const second = await engine.Begin(AccessScope.System);
            first.SetProperty('shop.w0', 'name', 'first');
            second.SetProperty('shop.w1', 'name', 'second');
            const committed = first.Commit();
            const rejected = ConnectorFx.Rejection(second.Commit());
            await committed;
            const error = await rejected;
            first.dispose();
            second.dispose();
            assert.ok(error instanceof ConnectorError, String(error));
            assert.equal(error.Connector, TodlFileConnector.ConnectorName);
            ConnectorFx.AssertBridge(error.cause, EngineBridgeErrorCode.Stale);
            const draft = ConnectorFx.Reparsed(workspace);
            assert.equal(ConnectorFx.Attrs(draft, 'shop.w0')?.name, 'first');
            assert.equal(ConnectorFx.Attrs(draft, 'shop.w1')?.name, undefined);
            assert.deepEqual(workspace.Log, [`${MemoryModelWorkspace.WriteVerb}${ConnectorFx.MainFile}`]);
        }
        finally
        {
            await engine.dispose();
        }
    });
});

describe('TodlNodePlacement', () =>
{
    test('placement mints namespaced ids', () =>
    {
        const placement = new TodlNodePlacement(ConnectorFx.Model, ConnectorFx.Namespace);
        const a = placement.Place(ConnectorFx.Widget, new Map());
        const b = placement.Place(ConnectorFx.Widget, new Map());
        assert.equal(a.Owner, ConnectorFx.Model);
        assert.match(a.PublicId, /^shop\.o[0-9a-z]+$/);
        assert.notEqual(a.PublicId, b.PublicId);
        const fixed = new TodlNodePlacement(ConnectorFx.Model, ConnectorFx.Namespace, { next: () => 'o1' });
        assert.deepEqual(fixed.Place(ConnectorFx.Loc, new Map()), { PublicId: 'shop.o1', Owner: ConnectorFx.Model });
    });
});
