import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { AccessScope, ConnectorChangeSet, Cypher, WriteOp, type CellValue, type ConnectorChange, type IConnectorTransaction } from '@pragmatic-tech-ai/graph';
import {
    QueryCompareOp,
    WriteAtomicity,
    WriteConcurrency,
    WriteFailureKind,
    WriteOperationKind,
    type ConnectorBinding,
    type ExternalRecord,
} from '../../../model-data/connector-plan.js';
import { DataSourceAdapterCatalog } from '../../../model-data/data-source-adapter-catalog.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import { EnvironmentNodePlacement } from '../../environment/EnvironmentNodePlacement.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { ChangeBatcher } from '../ChangeBatcher.js';
import { DataSourceConnector } from '../DataSourceConnector.js';
import { ExternalWriteError } from '../ExternalWriteError.js';
import { ExternalFixture as Fx, RecordingAdapter, RecordingAdapterFactory } from './ExternalFixture.js';

/** A connector over a (possibly overridden) customers binding and a recording adapter, with change builders. */
class WriteHarness
{
    public static readonly NewName = 'N';
    public static readonly Other = 'Other';
    public static readonly Beta = 'Beta';
    public static readonly Owner = 'other.Model';
    public static readonly Unmapped = 'unmapped';
    public static readonly Since = 'since';
    public static readonly Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    public static readonly CreateText = "CREATE (c:`crm.Customer` {name: 'N'}) RETURN c";

    public readonly Plan;
    public readonly Identity;
    public readonly Connector: DataSourceConnector;

    public constructor(public readonly Adapter: RecordingAdapter, overrides: Partial<ConnectorBinding> = {})
    {
        this.Plan = Fx.Plan(Fx.BindingWith(overrides));
        this.Identity = Fx.Identity(this.Plan);
        this.Connector = new DataSourceConnector(this.Plan, Adapter, this.Identity, Fx.Description());
    }

    public static Over(records: ExternalRecord[] = [], overrides: Partial<ConnectorBinding> = {}): WriteHarness
    {
        return new WriteHarness(Fx.Adapter(records), overrides);
    }

    public Id(storageId: string): string
    {
        return this.Identity.Mint(this.Plan.Bindings[0]!, storageId);
    }

    public static Create(id: string): ConnectorChange
    {
        return { Op: WriteOp.CreateNode, PublicId: id, Concept: Fx.Customer, Owner: Fx.Model };
    }

    public static Set(id: string, member: string, value: CellValue): ConnectorChange
    {
        return { Op: WriteOp.SetProperty, PublicId: id, Member: member, Value: value, Concept: Fx.Customer, Owner: Fx.Model };
    }

    public static Link(from: string, to: string, properties?: ReadonlyMap<string, CellValue>): ConnectorChange
    {
        const link = { Op: WriteOp.Link, From: from, Relationship: Fx.TeamRel, To: to, Concept: Fx.Customer, Owner: Fx.Model } as const;
        return properties === undefined ? link : { ...link, Options: { Properties: properties } };
    }

    public static Unlink(from: string, to: string): ConnectorChange
    {
        return { Op: WriteOp.Unlink, From: from, Relationship: Fx.TeamRel, To: to, Concept: Fx.Customer, Owner: Fx.Model };
    }

    public static Delete(id: string): ConnectorChange
    {
        return { Op: WriteOp.DeleteNode, PublicId: id, Concept: Fx.Customer, Owner: Fx.Model };
    }

    public static Changes(...changes: ConnectorChange[]): ConnectorChangeSet
    {
        return new ConnectorChangeSet(changes);
    }

    /** The operations ChangeBatcher makes of `changes` (one binding in the plan, so one batch). */
    public Operations(...changes: ConnectorChange[]): unknown
    {
        const batches = ChangeBatcher.Batches(WriteHarness.Changes(...changes), this.Identity, Fx.Connector);
        assert.equal(batches.length, 1);
        return batches[0]!.Batch.Operations;
    }

    /** A transaction with `changes` applied. */
    public async Applied(...changes: ConnectorChange[]): Promise<IConnectorTransaction>
    {
        const txn = await this.Connector.Begin();
        await txn.Apply(WriteHarness.Changes(...changes));
        return txn;
    }

    public static async Rejects(promise: Promise<unknown>, code: EngineBridgeErrorCode): Promise<unknown>
    {
        let caught: unknown;
        await assert.rejects(promise, (e: unknown) =>
        {
            caught = e;
            return e instanceof EngineBridgeError && e.Code === code;
        });
        return caught;
    }

    /** Existing customers 7 (Acme, team a) and 8 (Beta, no team). */
    public static Existing(): ExternalRecord[]
    {
        return [Fx.Record(7, Fx.Acme, Fx.TeamA, true), Fx.Record(8, WriteHarness.Beta, null, false)];
    }
}

describe('DataSourceConnector write side', () =>
{
    test('create sets merge into one upsert', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        assert.deepEqual(h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName), WriteHarness.Link(x, Fx.TeamA)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.IdKey]: 7, [Fx.NameField]: WriteHarness.NewName, [Fx.TeamField]: Fx.TeamA } },
        ]);
    });

    test('a numeric id member set on a create agrees with the key', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        assert.deepEqual(h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Id, 7n)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.IdKey]: 7 } },
        ]);
        assert.throws(
            () => h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Id, 8n)),
            (e: unknown) => e instanceof EngineBridgeError && e.Code === EngineBridgeErrorCode.UnsupportedExternalChange);
    });

    test('unlink clears the foreign key', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        assert.deepEqual(h.Operations(WriteHarness.Unlink(x, Fx.TeamA)), [{ Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.TeamField]: null } }]);
        // Re-pointing a single-valued link: the unlink of the old target does not clear the new one, in either order.
        assert.deepEqual(h.Operations(WriteHarness.Unlink(x, Fx.TeamA), WriteHarness.Link(x, WriteHarness.Other)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.TeamField]: WriteHarness.Other } },
        ]);
        assert.deepEqual(h.Operations(WriteHarness.Link(x, WriteHarness.Other), WriteHarness.Unlink(x, Fx.TeamA)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.TeamField]: WriteHarness.Other } },
        ]);
    });

    test('create then delete cancels', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        const batches = ChangeBatcher.Batches(
            WriteHarness.Changes(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName), WriteHarness.Delete(x)), h.Identity, Fx.Connector);
        assert.deepEqual(batches, []);
    });

    test('delete becomes delete', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        assert.deepEqual(h.Operations(WriteHarness.Unlink(x, Fx.TeamA), WriteHarness.Delete(x)), [{ Kind: WriteOperationKind.Delete, Key: 7, Fields: {} }]);
    });

    test('ops on several ids keep the order of first appearance in one batch per binding', () =>
    {
        const h = WriteHarness.Over();
        const [a, b] = [h.Id('8'), h.Id('7')];
        const batches = ChangeBatcher.Batches(
            WriteHarness.Changes(WriteHarness.Set(a, Fx.Name, WriteHarness.Beta), WriteHarness.Set(b, Fx.Name, Fx.Acme), WriteHarness.Set(a, Fx.Active, true)),
            h.Identity, Fx.Connector);
        assert.equal(batches.length, 1);
        assert.equal(batches[0]!.Binding, h.Plan.Bindings[0]);
        assert.deepEqual(batches[0]!.Batch, {
            Source: Fx.Source, IdKey: Fx.IdKey, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [
                { Kind: WriteOperationKind.Upsert, Key: 8, Fields: { [Fx.NameField]: WriteHarness.Beta, [Fx.ActiveField]: true } },
                { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.NameField]: Fx.Acme } },
            ],
        });
    });

    test('apply refuses what it cannot express', async () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id('7');
        const refused: [ConnectorChange, EngineBridgeErrorCode][] = [
            [{ Op: WriteOp.SetOwner, PublicId: x, Owner: WriteHarness.Owner, Concept: Fx.Customer }, EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(x, WriteHarness.Unmapped, 1n), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(x, Fx.Id, 9n), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Link(x, Fx.TeamA, new Map<string, CellValue>([[WriteHarness.Since, 1n]])), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(Fx.TeamA, Fx.Name, WriteHarness.NewName), EngineBridgeErrorCode.ForeignId],
        ];
        for (const [change, code] of refused)
        {
            const txn = await h.Connector.Begin();
            await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(change)), code);
        }
        const readOnly = WriteHarness.Over([], { Writable: false });
        const txn = await readOnly.Connector.Begin();
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(readOnly.Id('7'), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.NotWritable);
        assert.equal(h.Adapter.Calls + readOnly.Adapter.Calls, 0);
    });

    test('transactional binding needs a transacting adapter', async () =>
    {
        const h = WriteHarness.Over([], { Atomicity: WriteAtomicity.Transactional });
        const txn = await h.Connector.Begin();
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.UnsupportedExternalChange);
        h.Adapter.CanTransact = true;
        const ok = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await ok.Commit();
        assert.equal(h.Adapter.Batches.length, 1);
    });

    test('per-op failure throws ExternalWriteError', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        h.Adapter.FailAfter = 0;
        h.Adapter.FailKind = WriteFailureKind.Conflict;
        const txn = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        const error = await WriteHarness.Rejects(txn.Commit(), EngineBridgeErrorCode.ExternalWriteFailed);
        assert.ok(error instanceof ExternalWriteError);
        assert.equal(error.Binding, h.Plan.Bindings[0]);
        assert.equal(error.Failures[0]!.Key, 7);
        assert.equal(error.Failures[0]!.Kind, WriteFailureKind.Conflict);
    });

    test('partial sequential batch is compensated', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await Fx.Rows(h.Adapter);
        h.Adapter.FailAfter = 2;
        // One new key (9) and two existing ones (7, 8); the source applies 9 and 7, then fails 8.
        const txn = await h.Applied(
            WriteHarness.Create(h.Id('9')), WriteHarness.Set(h.Id('9'), Fx.Name, WriteHarness.NewName),
            WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName),
            WriteHarness.Set(h.Id('8'), Fx.Name, WriteHarness.NewName));
        await WriteHarness.Rejects(txn.Commit(), EngineBridgeErrorCode.ExternalWriteFailed);
        const midway = await Fx.Rows(h.Adapter);
        assert.equal(midway.length, 3);
        await txn.Revert();
        assert.deepEqual(await Fx.Rows(h.Adapter), before);
        // Compensation in reverse order of what applied: 7 restored, then 9 deleted; 8 never applied.
        const compensation = h.Adapter.Batches.slice(1).flatMap(b => b.Operations);
        assert.deepEqual(compensation.map(o => [o.Kind, o.Key]), [[WriteOperationKind.Upsert, 7], [WriteOperationKind.Delete, 9]]);
    });

    test('a batch whose adapter call throws compensates every op of it', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await Fx.Rows(h.Adapter);
        h.Adapter.ThrowAtCall = 2;
        const txn = await h.Applied(WriteHarness.Create(h.Id('9')), WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await assert.rejects(txn.Commit());
        await txn.Revert();
        assert.deepEqual(await Fx.Rows(h.Adapter), before);
    });

    test('a failed transactional batch applied nothing, so nothing is compensated', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing(), { Atomicity: WriteAtomicity.Transactional });
        h.Adapter.CanTransact = true;
        h.Adapter.FailAfter = 0;
        const txn = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await WriteHarness.Rejects(txn.Commit(), EngineBridgeErrorCode.ExternalWriteFailed);
        const calls = h.Adapter.Calls;
        await txn.Revert();
        assert.equal(h.Adapter.Calls, calls);
    });

    test('revert after commit compensates', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await Fx.Rows(h.Adapter);
        const txn = await h.Applied(
            WriteHarness.Create(h.Id('9')), WriteHarness.Set(h.Id('9'), Fx.Name, WriteHarness.NewName),
            WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName), WriteHarness.Delete(h.Id('8')));
        await txn.Commit();
        assert.deepEqual((await Fx.Rows(h.Adapter)).map(r => r[Fx.IdKey]), [7, 9]);
        await txn.Revert();
        const after = await Fx.Rows(h.Adapter);
        assert.deepEqual([...after].sort((a, b) => Number(a[Fx.IdKey]) - Number(b[Fx.IdKey])), before);
    });

    test('revert before commit touches nothing', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const txn = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await txn.Revert();
        assert.equal(h.Adapter.Calls, 0);
        await WriteHarness.Rejects(txn.Commit(), EngineBridgeErrorCode.TransactionClosed);
    });

    test('optimistic binding guards with the before-image version', async () =>
    {
        const h = WriteHarness.Over([{ ...Fx.Record(7, Fx.Acme, Fx.TeamA), [Fx.RevField]: 3 }],
            { Concurrency: WriteConcurrency.Optimistic, VersionField: Fx.RevField });
        const txn = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await txn.Commit();
        const batch = h.Adapter.Batches[0]!;
        assert.equal(batch.Concurrency, WriteConcurrency.Optimistic);
        assert.equal(batch.VersionField, Fx.RevField);
        assert.equal(batch.Operations[0]!.Version, 3);
        // The before-image read: IdKey in the batch keys, over every mapped field and the version field.
        const read = h.Adapter.Queries[0]!;
        assert.deepEqual(read.Where, { All: [{ Field: Fx.IdKey, Op: QueryCompareOp.In, Value: null, Values: [7] }] });
        assert.ok(read.Fields.includes(Fx.RevField) && read.Fields.includes(Fx.TeamField));
    });

    test('failed compensation throws CompensationFailed', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const txn = await h.Applied(WriteHarness.Set(h.Id('7'), Fx.Name, WriteHarness.NewName));
        await txn.Commit();
        // Calls: 1 before-image read, 2 apply, 3 the compensating apply.
        h.Adapter.ThrowAtCall = 3;
        const error = await WriteHarness.Rejects(txn.Revert(), EngineBridgeErrorCode.CompensationFailed);
        assert.ok(error instanceof ExternalWriteError);
        assert.equal(error.Binding, h.Plan.Bindings[0]);
    });

    test('engine write-through', async () =>
    {
        const adapter = Fx.Adapter([]);
        const plan = Fx.Plan();
        const identity = Fx.Identity(plan);
        const catalog = new DataSourceAdapterCatalog().Register(new RecordingAdapterFactory(adapter));
        const connector = await DataSourceConnector.Open(plan, catalog, new ServiceProvider(), identity, Fx.Description());
        const engine = await EngineFixture.Open({ Description: Fx.Description(), External: new Set(), Diagnostics: [] }, { Connectors: [connector] });
        try
        {
            const placement = new EnvironmentNodePlacement(identity, new Map([[Fx.Team, Fx.Model]]), randomUUID);
            const result = await new Cypher.CypherEngine(engine).Execute(AccessScope.System, WriteHarness.CreateText, { Placement: placement });
            const rows = await Fx.Rows(adapter);
            assert.equal(rows.length, 1);
            const key = rows[0]![Fx.IdKey];
            assert.equal(typeof key, 'string');
            assert.match(key as string, WriteHarness.Uuid);
            assert.equal(rows[0]![Fx.NameField], WriteHarness.NewName);
            const node = result.Rows[0]![0] as Cypher.NodeValue;
            const parsed = identity.Parse(node.Id);
            assert.equal(parsed?.Binding, plan.Bindings[0]);
            assert.equal(parsed?.StorageId, key);
        }
        finally
        {
            await engine.dispose();
            await catalog.Dispose();
        }
    });
});
