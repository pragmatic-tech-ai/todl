import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AccessScope,
    ConnectorChangeSet,
    ConnectorError,
    Cypher,
    DateTimeValue,
    DateValue,
    DurationValue,
    GraphEngine,
    StorageKind,
    WriteOp,
    type CellValue,
    type ConnectorChange,
    type IConnectorTransaction,
} from '@pragmatic-tech-ai/graph';
import { ModelDraft } from '../../authoring/model-draft.js';
import { checkAgainst } from '../../compiler-services/api.js';
import { Severity } from '../../compiler-services/diagnostics/diagnostic.js';
import { Domain } from '../../domain/domain.js';
import { MemoryPackageSource } from '../../domain/memory-package-source.js';
import { compilePackage, PackageKind, type PackageRef } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import type { TodlDocument } from '../../compiler-services/emit/json.js';
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
    public static readonly W0 = 'shop.w0';
    public static readonly W1 = 'shop.w1';
    public static readonly W2 = 'shop.w2';
    public static readonly W5 = 'shop.w5';
    public static readonly L1 = 'shop.l1';
    public static readonly L2 = 'shop.l2';
    public static readonly Missing = 'shop.nope';
    public static readonly Name = 'name';
    public static readonly Count = 'count';
    public static readonly Weight = 'weight';
    public static readonly Kind = 'kind';
    public static readonly Kinds = 'kinds';
    public static readonly Home = 'home';
    public static readonly Parts = 'parts';
    public static readonly Changed = 'changed';
    public static readonly First = 'first';
    public static readonly Second = 'second';
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

    /** Two independent one-file models, for the multi-model rules. */
    public static readonly Alpha = { Model: 'alpha.p', Namespace: 'alpha', File: 'alpha.todl', Box: 'alpha.Box', Node: 'alpha.b', Text: 'namespace alpha { concept Box { name : string?; } model A : alpha { Box b { } } }' };
    public static readonly Beta = { Model: 'beta.p', Namespace: 'beta', File: 'beta.todl', Box: 'beta.Box', Node: 'beta.b', Text: 'namespace beta { concept Box { name : string?; } model B : beta { Box b { } } }' };

    /** A model in another package that references a shop node. */
    public static readonly Other = { Model: 'other.p', Namespace: 'other', File: 'other.todl', Pin: 'other.Pin', Node: 'other.p', At: 'at', Text: 'namespace other { concept Pin { relationship at -> shop.Loc?; } model O : other { Pin p { at = shop.l1; } } }' };
    public static readonly DetachLocs = 'MATCH (l:`shop.Loc`) DETACH DELETE l';
    /** Two models of one namespace declared in one file. */
    public static readonly Duo = { First: 'duo.p1', Second: 'duo.p2', Namespace: 'duo', File: 'duo.todl', SchemaFile: 'schema.todl', Box: 'duo.Box', A: 'duo.a', B: 'duo.b', Schema: 'namespace duo { concept Box { name : string?; } }', Text: 'namespace duo { model A : duo { Box a { } } model B : duo { Box b { } } }' };
    public static readonly Unrestored = /could not be restored/;
    public static readonly OneUnrestored = /; 1 file\(s\) could not be restored/;

    public static Workspace(): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        workspace.Add(ConnectorFx.Model, ConnectorFx.Namespace, { [ConnectorFx.MainFile]: ConnectorFx.Shop });
        return workspace;
    }

    /** Alpha and Beta, registered in the given order. */
    public static TwoModels(betaFirst: boolean): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        for (const m of betaFirst ? [ConnectorFx.Beta, ConnectorFx.Alpha] : [ConnectorFx.Alpha, ConnectorFx.Beta])
        {
            workspace.Add(m.Model, m.Namespace, { [m.File]: m.Text });
        }
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
    public static Reparsed(workspace: MemoryModelWorkspace, uris: readonly string[] = [ConnectorFx.MainFile, ConnectorFx.DefaultFile], namespace: string = ConnectorFx.Namespace, bases: Parameters<typeof ModelDraft.fromSources>[0] = []): ModelDraft
    {
        const sources = uris.filter((u) => workspace.Files.has(u)).map((uri) => ({ uri, text: workspace.Files.get(uri)! }));
        return ModelDraft.fromSources(bases, sources, { namespace });
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

    public static AssertBridge(error: unknown, code: EngineBridgeErrorCode): EngineBridgeError
    {
        assert.ok(error instanceof EngineBridgeError, String(error));
        assert.equal(error.Code, code, error.message);
        return error;
    }

    public static Written(uri: string): string
    {
        return MemoryModelWorkspace.WriteVerb + uri;
    }

    public static Deleted(uri: string): string
    {
        return MemoryModelWorkspace.DeleteVerb + uri;
    }

    /** Compiles `sources` (each `{ model, file, text }`, later ones over the earlier) and opens an engine described from them with the file connector as the default. */
    public static async Engine(connector: TodlFileConnector, sources: readonly { Model: string; File: string; Text: string }[] = [{ Model: ConnectorFx.Model, File: ConnectorFx.MainFile, Text: ConnectorFx.Shop }]): Promise<GraphEngine>
    {
        const store = new MemoryPackageSource();
        const bases: TodlDocument[] = [];
        const dependencies: PackageRef[] = [];
        for (const source of sources)
        {
            const out = compilePackage(bases, [{ uri: source.File, text: source.Text }], { id: source.Model, version: ConnectorFx.Version }, [...dependencies]);
            assert.ok(out.ok, JSON.stringify(out.errors));
            store.Add(PackageManifestBridge.toResolved(out.package!));
            bases.push(out.package!.fullDocument);
            dependencies.push({ kind: PackageKind.Architecture, id: source.Model, version: ConnectorFx.Version });
        }
        const domain = new Domain(store);
        await domain.load({ model: sources[sources.length - 1]!.Model, version: ConnectorFx.Version });
        const { Description } = SnapshotDescriber.Describe(domain.Snapshot, { DefaultConnector: TodlNames.FileConnector });
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
            ConnectorFx.Create(ConnectorFx.W2, ConnectorFx.Widget),
            ConnectorFx.Set(ConnectorFx.W2, ConnectorFx.Name, 'two'),
            ConnectorFx.Set(ConnectorFx.W2, ConnectorFx.Count, 5n),
            ConnectorFx.Set(ConnectorFx.W2, ConnectorFx.Weight, 2.5),
            ConnectorFx.Set(ConnectorFx.W2, TodlNames.Label, 'Two'),
            ConnectorFx.Set(ConnectorFx.W2, ConnectorFx.Kind, ConnectorFx.Big),
            ConnectorFx.Link(ConnectorFx.W2, ConnectorFx.Kinds, ConnectorFx.Small),
            ConnectorFx.Link(ConnectorFx.W2, ConnectorFx.Home, ConnectorFx.L1),
            ConnectorFx.Link(ConnectorFx.W0, ConnectorFx.Parts, ConnectorFx.W2),
            ConnectorFx.Set(ConnectorFx.W0, ConnectorFx.Kind, ConnectorFx.Big),
            ConnectorFx.Unlink(ConnectorFx.W0, ConnectorFx.Kinds, ConnectorFx.Big),
            ConnectorFx.Delete(ConnectorFx.L2, ConnectorFx.Loc),
        ]);
        await txn.Commit();
        const draft = ConnectorFx.Reparsed(workspace);
        assert.deepEqual(draft.diagnostics.filter((d) => d.severity === Severity.Error), []);
        // TODL keeps numeric literals as decimal strings once parsed.
        assert.deepEqual(ConnectorFx.Attrs(draft, ConnectorFx.W2), { type: ConnectorFx.Widget, name: 'two', count: '5', weight: '2.5', label: 'Two' });
        assert.match(workspace.Files.get(ConnectorFx.DefaultFile)!, /count = 5;/);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W2, ConnectorFx.Kind), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W2, ConnectorFx.Kinds), [ConnectorFx.Small]);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W2, ConnectorFx.Home), [ConnectorFx.L1]);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W0, ConnectorFx.Parts), [ConnectorFx.W2]);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W0, ConnectorFx.Kind), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W0, ConnectorFx.Kinds), []);
        assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.L2), undefined);
        assert.deepEqual(ConnectorFx.Attrs(draft, ConnectorFx.W0), { type: ConnectorFx.Widget, name: 'w' });
    });

    test('null removes field', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const first = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, TodlNames.Label, 'One')]);
        await first.Commit();
        assert.equal(ConnectorFx.Attrs(ConnectorFx.Reparsed(workspace), ConnectorFx.W1)?.label, 'One');
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(ConnectorFx.W0, ConnectorFx.Name, null),
            ConnectorFx.Set(ConnectorFx.W0, ConnectorFx.Kind, null),
            ConnectorFx.Set(ConnectorFx.W1, TodlNames.Label, null),
        ]);
        await txn.Commit();
        const draft = ConnectorFx.Reparsed(workspace);
        assert.deepEqual(ConnectorFx.Attrs(draft, ConnectorFx.W0), { type: ConnectorFx.Widget });
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W0, ConnectorFx.Kind), []);
        assert.deepEqual(ConnectorFx.Refs(draft, ConnectorFx.W0, ConnectorFx.Kinds), [ConnectorFx.Big]);
        assert.deepEqual(ConnectorFx.Attrs(draft, ConnectorFx.W1), { type: ConnectorFx.Widget });
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
            [ConnectorFx.Count, new DateValue(3)],
            [ConnectorFx.Count, new DateTimeValue(1_000_000n, 'UTC')],
            [ConnectorFx.Count, new DurationValue(1, 2, 3n)],
            [ConnectorFx.Weight, Number.NaN],
            [ConnectorFx.Weight, Number.POSITIVE_INFINITY],
            [ConnectorFx.Weight, Number.NEGATIVE_INFINITY],
            [TodlNames.Class, ConnectorFx.Big],
        ];
        for (const [member, value] of values)
        {
            const txn = await connector.Begin();
            ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([ConnectorFx.Set(ConnectorFx.W0, member, value)]))), EngineBridgeErrorCode.UnsupportedValue);
            await txn.Revert();
        }
    });

    test('non-editable model rejected', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await connector.Begin();
        const change = ConnectorFx.Set('lib.x', ConnectorFx.Name, 'n', ConnectorFx.Widget, 'lib.p');
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([change]))), EngineBridgeErrorCode.NotEditable);
        await txn.Revert();
        const writes = [
            ConnectorFx.Set(ConnectorFx.Missing, ConnectorFx.Name, 'n'),
            ConnectorFx.Set(ConnectorFx.Missing, ConnectorFx.Kind, null),
            ConnectorFx.Unlink(ConnectorFx.Missing, ConnectorFx.Kinds, ConnectorFx.Big),
            ConnectorFx.Link(ConnectorFx.W0, ConnectorFx.Parts, ConnectorFx.Missing),
            ConnectorFx.Delete(ConnectorFx.Missing, ConnectorFx.Widget),
            ConnectorFx.Delete(ConnectorFx.Big, ConnectorFx.Widget),
            ConnectorFx.Create(ConnectorFx.W1, ConnectorFx.Widget),
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
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, 'mine')]);
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
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, 'dropped')]);
        await txn.Revert();
        assert.deepEqual(workspace.Log, []);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        const next = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, 'kept')]);
        await next.Commit();
        assert.equal(ConnectorFx.Attrs(ConnectorFx.Reparsed(workspace), ConnectorFx.W1)?.name, 'kept');
    });

    test('a second commit rejects instead of throwing', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed)]);
        await txn.Commit();
        let again: Promise<void> | undefined;
        assert.doesNotThrow(() => { again = txn.Commit(); });
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(again!), EngineBridgeErrorCode.TransactionClosed);
    });

    test('revert after commit restores originals', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed),
            ConnectorFx.Create(ConnectorFx.W5, ConnectorFx.Widget),
        ]);
        await txn.Commit();
        assert.ok(workspace.Files.has(ConnectorFx.DefaultFile), 'the commit created the default file');
        assert.notEqual(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        await txn.Revert();
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        assert.deepEqual(workspace.Log.slice(-2), [ConnectorFx.Deleted(ConnectorFx.DefaultFile), ConnectorFx.Written(ConnectorFx.MainFile)]);
    });

    test('revert after commit does not overwrite a later write', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed)]);
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
            ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed),
            ConnectorFx.Create(ConnectorFx.W5, ConnectorFx.Widget),
        ]);
        workspace.FailWriteAt = 2;
        const error = ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.equal((error.cause as Error).message, MemoryModelWorkspace.WriteFailure, 'the storage error is the cause');
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        await txn.Revert();
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
    });

    test('a torn write is restored', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed),
            ConnectorFx.Create(ConnectorFx.W5, ConnectorFx.Widget),
        ]);
        workspace.FailWriteAt = 1;
        workspace.TornWrite = true;
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop, 'the half-written file holds its original again');
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        // A torn write of a file the commit was creating is removed.
        const created = await ConnectorFx.Applied(connector, [ConnectorFx.Create(ConnectorFx.W5, ConnectorFx.Widget)]);
        // main.todl is untouched by this create (its emission equals its baseline), so it is not rewritten: the new
        // default file is the only write, torn.
        workspace.FailWrite(1);
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(created.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.equal(workspace.Files.has(ConnectorFx.DefaultFile), false);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop);
    });

    test('a file the transaction\'s changes leave as it emitted at open is never rewritten (no re-format)', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Create(ConnectorFx.W5, ConnectorFx.Widget)]);
        await txn.Commit();
        assert.deepEqual(workspace.Log, [ConnectorFx.Written(ConnectorFx.DefaultFile)]);
        assert.equal(workspace.Files.get(ConnectorFx.MainFile), ConnectorFx.Shop, 'byte-identical: not even normalized');
    });

    test('several models commit in owner-name order', async () =>
    {
        const { Alpha, Beta } = ConnectorFx;
        const workspace = ConnectorFx.TwoModels(true);
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(Beta.Node, ConnectorFx.Name, 'B', Beta.Box, Beta.Model),
            ConnectorFx.Set(Alpha.Node, ConnectorFx.Name, 'A', Alpha.Box, Alpha.Model),
        ]);
        await txn.Commit();
        assert.deepEqual(workspace.Log, [ConnectorFx.Written(Alpha.File), ConnectorFx.Written(Beta.File)]);
        assert.match(workspace.Files.get(Alpha.File)!, /name = "A"/);
        assert.match(workspace.Files.get(Beta.File)!, /name = "B"/);
    });

    test('a stale later model fails the commit before any model is written', async () =>
    {
        const { Alpha, Beta } = ConnectorFx;
        const workspace = ConnectorFx.TwoModels(false);
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(Alpha.Node, ConnectorFx.Name, 'A', Alpha.Box, Alpha.Model),
            ConnectorFx.Set(Beta.Node, ConnectorFx.Name, 'B', Beta.Box, Beta.Model),
        ]);
        workspace.Files.set(Beta.File, Beta.Text + '\n');
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.Stale);
        assert.deepEqual(workspace.Log, [], 'no write-then-restore');
        assert.equal(workspace.Files.get(Alpha.File), Alpha.Text);
        assert.equal(workspace.Files.get(Beta.File), Beta.Text + '\n');
    });

    test('a later model failing to write restores the earlier ones', async () =>
    {
        const { Alpha, Beta } = ConnectorFx;
        const workspace = ConnectorFx.TwoModels(false);
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(Alpha.Node, ConnectorFx.Name, 'A', Alpha.Box, Alpha.Model),
            ConnectorFx.Set(Beta.Node, ConnectorFx.Name, 'B', Beta.Box, Beta.Model),
        ]);
        workspace.FailWriteAt = 2;
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.equal(workspace.Files.get(Alpha.File), Alpha.Text);
        assert.equal(workspace.Files.get(Beta.File), Beta.Text);
    });

    test('a refused write is not counted as unrestored', async () =>
    {
        const { Duo } = ConnectorFx;
        // Both models draft over one shared file: the first writes it, then the second's session refuses its write Stale.
        const workspace = new MemoryModelWorkspace();
        workspace.Add(Duo.First, Duo.Namespace, { [Duo.SchemaFile]: Duo.Schema, [Duo.File]: Duo.Text });
        workspace.Add(Duo.Second, Duo.Namespace, { [Duo.SchemaFile]: Duo.Schema, [Duo.File]: Duo.Text });
        workspace.Refuse(Duo.Second);
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(Duo.A, ConnectorFx.Name, 'A', Duo.Box, Duo.First),
            ConnectorFx.Set(Duo.B, ConnectorFx.Name, 'B', Duo.Box, Duo.Second),
        ]);
        const error = ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.Stale);
        assert.doesNotMatch(error.message, ConnectorFx.Unrestored);
        assert.equal(workspace.Files.get(Duo.File), Duo.Text, "the first model's write was restored");
    });

    test('a write that cannot be restored is still counted', async () =>
    {
        const { Alpha, Beta } = ConnectorFx;
        const workspace = ConnectorFx.TwoModels(false);
        const connector = new TodlFileConnector(workspace);
        const txn = await ConnectorFx.Applied(connector, [
            ConnectorFx.Set(Alpha.Node, ConnectorFx.Name, 'A', Alpha.Box, Alpha.Model),
            ConnectorFx.Set(Beta.Node, ConnectorFx.Name, 'B', Beta.Box, Beta.Model),
        ]);
        workspace.FailWriteAt = 2;
        workspace.FailRest = true;
        const error = ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.PersistFailed);
        assert.match(error.message, ConnectorFx.OneUnrestored);
        assert.match(workspace.Files.get(Alpha.File)!, /name = "A"/, 'alpha\'s write could not be put back');
    });

    test('a commit waits for the in-flight commit of its model, then sees it stale', async () =>
    {
        const workspace = ConnectorFx.Workspace();
        const connector = new TodlFileConnector(workspace);
        const first = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W0, ConnectorFx.Name, ConnectorFx.First)]);
        const second = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Second)]);
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
        assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.W0)?.name, ConnectorFx.First);
        assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.W1)?.name, undefined);
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
            first.SetProperty(ConnectorFx.W0, ConnectorFx.Name, ConnectorFx.First);
            second.SetProperty(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Second);
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
            assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.W0)?.name, ConnectorFx.First);
            assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.W1)?.name, undefined);
            assert.deepEqual(workspace.Log, [ConnectorFx.Written(ConnectorFx.MainFile)]);
        }
        finally
        {
            await engine.dispose();
        }
    });

    test('a Cypher DETACH DELETE removes the reference held in another model\'s file', async () =>
    {
        const { Other } = ConnectorFx;
        const shopBase = checkAgainst([], [{ uri: ConnectorFx.MainFile, text: ConnectorFx.Shop }]).model;
        const workspace = ConnectorFx.Workspace();
        workspace.Add(Other.Model, Other.Namespace, { [Other.File]: Other.Text }, [shopBase]);
        const connector = new TodlFileConnector(workspace);
        const engine = await ConnectorFx.Engine(connector, [
            { Model: ConnectorFx.Model, File: ConnectorFx.MainFile, Text: ConnectorFx.Shop },
            { Model: Other.Model, File: Other.File, Text: Other.Text },
        ]);
        try
        {
            // The engine routes DETACH DELETE's explicit Unlink of other.p -at-> shop.l1 by its source's owner, other.p.
            await new Cypher.CypherEngine(engine).Execute(AccessScope.System, ConnectorFx.DetachLocs);
            const other = ConnectorFx.Reparsed(workspace, [Other.File], Other.Namespace, [shopBase]);
            assert.deepEqual(ConnectorFx.Refs(other, Other.Node, Other.At), []);
            assert.deepEqual(other.diagnostics.filter((d) => d.severity === Severity.Error), []);
            const shop = ConnectorFx.Reparsed(workspace);
            assert.equal(ConnectorFx.Attrs(shop, ConnectorFx.L1), undefined);
            assert.equal(ConnectorFx.Attrs(shop, ConnectorFx.L2), undefined);
            assert.deepEqual(ConnectorFx.Refs(shop, ConnectorFx.W0, ConnectorFx.Home), []);
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

/** Fixtures for the refusal and routing rules added by the final review (PF-d, PF-e, R89 plain delete). */
class RefusalFx
{
    public static readonly Pinned = 'pinned';
    public static readonly W9 = 'shop.w9';
    public static readonly BigTerm = 'term Big { }';
    public static readonly PinningBigTerm = `term Big { name = "${RefusalFx.Pinned}"; }`;
    public static readonly W1Line = 'Widget w1 { }';
    public static readonly W1AndClassedW9 = `${RefusalFx.W1Line}\n        Widget w9 instanceof Kinds.Big { }`;
    /** The shop with a term that pins `name`, and w9 classed by it. */
    public static readonly ClassedShop = ConnectorFx.Shop
        .replace(RefusalFx.BigTerm, RefusalFx.PinningBigTerm)
        .replace(RefusalFx.W1Line, RefusalFx.W1AndClassedW9);
    public static readonly UnknownOp = 99;

    public static ClassedWorkspace(): MemoryModelWorkspace
    {
        const workspace = new MemoryModelWorkspace();
        workspace.Add(ConnectorFx.Model, ConnectorFx.Namespace, { [ConnectorFx.MainFile]: RefusalFx.ClassedShop });
        return workspace;
    }
}

describe('TodlFileConnector refusals and routing', () =>
{
    test('SET null on a class-fixed field is refused, a value on it and null elsewhere are not (PF-d)', async () =>
    {
        const workspace = RefusalFx.ClassedWorkspace();
        const connector = new TodlFileConnector(workspace);
        const refused = await connector.Begin();
        const error = ConnectorFx.AssertBridge(await ConnectorFx.Rejection(refused.Apply(new ConnectorChangeSet([ConnectorFx.Set(RefusalFx.W9, ConnectorFx.Name, null)]))), EngineBridgeErrorCode.UnsupportedValue);
        assert.ok(error.message.includes(ConnectorFx.Name) && error.message.includes(RefusalFx.W9), error.message);
        await refused.Revert();
        const allowed = await ConnectorFx.Applied(connector, [ConnectorFx.Set(RefusalFx.W9, ConnectorFx.Name, ConnectorFx.Changed), ConnectorFx.Set(ConnectorFx.W0, ConnectorFx.Name, null)]);
        await allowed.Commit();
        const draft = ConnectorFx.Reparsed(workspace);
        assert.equal(ConnectorFx.Attrs(draft, RefusalFx.W9)?.name, ConnectorFx.Changed);
        assert.equal(ConnectorFx.Attrs(draft, ConnectorFx.W0)?.name, undefined);
    });

    test('an unknown or seed-only op is refused, not skipped', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        const changes = [
            { Op: WriteOp.SetOwner, PublicId: ConnectorFx.W0, Owner: ConnectorFx.Model, Concept: ConnectorFx.Widget } as ConnectorChange,
            { ...ConnectorFx.Delete(ConnectorFx.W0, ConnectorFx.Widget), Op: RefusalFx.UnknownOp } as unknown as ConnectorChange,
        ];
        for (const change of changes)
        {
            const txn = await connector.Begin();
            ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([change]))), EngineBridgeErrorCode.UnsupportedValue);
            await txn.Revert();
        }
    });

    test('a closed transaction refuses Apply and Commit with TransactionClosed', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        const txn = await ConnectorFx.Applied(connector, [ConnectorFx.Set(ConnectorFx.W1, ConnectorFx.Name, ConnectorFx.Changed)]);
        await txn.Commit();
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Commit()), EngineBridgeErrorCode.TransactionClosed);
        ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([]))), EngineBridgeErrorCode.TransactionClosed);
    });

    test('an Unlink refusal names neither end node (PF-e)', async () =>
    {
        const connector = new TodlFileConnector(ConnectorFx.Workspace());
        for (const from of [ConnectorFx.Missing, ConnectorFx.Big])
        {
            const txn = await connector.Begin();
            const error = ConnectorFx.AssertBridge(await ConnectorFx.Rejection(txn.Apply(new ConnectorChangeSet([ConnectorFx.Unlink(from, ConnectorFx.Parts, ConnectorFx.W1)]))), EngineBridgeErrorCode.NotEditable);
            assert.ok(!error.message.includes(from) && !error.message.includes(ConnectorFx.W1), error.message);
            await txn.Revert();
        }
    });

    test('a plain DeleteNode removes the reference held in another model\'s file (R89)', async () =>
    {
        const { Other } = ConnectorFx;
        const shopBase = checkAgainst([], [{ uri: ConnectorFx.MainFile, text: ConnectorFx.Shop }]).model;
        const workspace = ConnectorFx.Workspace();
        workspace.Add(Other.Model, Other.Namespace, { [Other.File]: Other.Text }, [shopBase]);
        const connector = new TodlFileConnector(workspace);
        const engine = await ConnectorFx.Engine(connector, [
            { Model: ConnectorFx.Model, File: ConnectorFx.MainFile, Text: ConnectorFx.Shop },
            { Model: Other.Model, File: Other.File, Text: Other.Text },
        ]);
        try
        {
            const txn = await engine.Begin(AccessScope.System);
            txn.DeleteNode(ConnectorFx.L1);
            await txn.Commit();
            const other = ConnectorFx.Reparsed(workspace, [Other.File], Other.Namespace, [shopBase]);
            assert.deepEqual(ConnectorFx.Refs(other, Other.Node, Other.At), []);
            assert.deepEqual(other.diagnostics.filter((d) => d.severity === Severity.Error), []);
            const shop = ConnectorFx.Reparsed(workspace);
            assert.equal(ConnectorFx.Attrs(shop, ConnectorFx.L1), undefined);
            assert.deepEqual(ConnectorFx.Refs(shop, ConnectorFx.W0, ConnectorFx.Home), []);
        }
        finally
        {
            await engine.dispose();
        }
    });
});
