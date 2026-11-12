import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import {
    AccessScope,
    ConflictError,
    ConnectorChangeSet,
    ConnectorContext,
    ConnectorError,
    Cypher,
    WriteOp,
    type CellValue,
    type ConnectorChange,
    type GraphEngine,
    type IAssignedCreate,
    type IConnectorTransaction,
    type RowVersion,
} from '@pragmatic-tech-ai/graph';
import {
    QueryCompareOp,
    WriteAtomicity,
    WriteConcurrency,
    WriteFailureKind,
    WriteOperationKind,
    type ConnectorBinding,
    type ExternalRecord,
    type IAssignedKey,
    type QueryRequest,
    type WriteBatch,
    type WriteResult,
} from '../../../model-data/connector-plan.js';
import type { IDataSourceAdapter } from '../../../model-data/data-source-adapter.js';
import { DataSourceAdapterCatalog } from '../../../model-data/data-source-adapter-catalog.js';
import { SqlAdapter } from '../../../model-data/sql-adapter.js';
import { InMemoryAdapter } from '../../../model-data/tests/fakes.js';
import { RecordingSqlSession } from '../../../model-data/tests/sql-fakes.js';
import { VersionBumpingAdapter } from '../../../model-data/version-bumping-adapter.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../../EngineBridgeError.js';
import { EnvironmentNodePlacement } from '../../environment/EnvironmentNodePlacement.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import { ChangeBatcher } from '../ChangeBatcher.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../ExternalBinding.js';
import type { ExternalIdentity } from '../ExternalIdentity.js';
import { DataSourceConnector } from '../DataSourceConnector.js';
import { ExternalVersionConflict } from '../ExternalVersionConflict.js';
import { ExternalWriteError } from '../ExternalWriteError.js';
import { ExternalFixture as Fx, RecordingAdapter, RecordingAdapterFactory } from './ExternalFixture.js';

/** An engine over the fixture description with one DataSourceConnector over `binding`, as an environment host opens it. */
class EngineHarness
{
    public static readonly CreateNamed = "CREATE (c:`crm.Customer` {name: 'N'}) RETURN c";
    public static readonly CreateWithId = "CREATE (c:`crm.Customer` {id: 9, name: 'N'}) RETURN c";

    private constructor(
        public readonly Adapter: RecordingAdapter,
        public readonly Plan: IExternalConnectorPlan,
        public readonly Identity: ExternalIdentity,
        public readonly Engine: GraphEngine,
        private readonly catalog: DataSourceAdapterCatalog,
    )
    {
    }

    public static async Open(binding: IExternalBinding): Promise<EngineHarness>
    {
        const adapter = Fx.Adapter([]);
        adapter.PartialUpserts = true;
        const plan = Fx.Plan(binding);
        const identity = Fx.Identity(plan);
        const catalog = new DataSourceAdapterCatalog().Register(new RecordingAdapterFactory(adapter));
        const connector = await DataSourceConnector.Open(plan, catalog, new ServiceProvider(), identity);
        const engine = await EngineFixture.Open({ Description: Fx.Description(), External: new Set(), Diagnostics: [] }, { Connectors: [connector] });
        return new EngineHarness(adapter, plan, identity, engine, catalog);
    }

    public Execute(text: string): Promise<Cypher.CypherResult>
    {
        const placement = new EnvironmentNodePlacement(this.Identity, new Map([[Fx.Team, Fx.Model]]), new Set(), Fx.Principal, randomUUID);
        return new Cypher.CypherEngine(this.Engine).Execute(AccessScope.System, text, { Placement: placement });
    }

    /** True when `error` (a Cypher write error) was caused by a ConnectorError whose cause is a bridge error of `code`. */
    public static ConnectorCause(error: unknown, code: EngineBridgeErrorCode): boolean
    {
        const connector = error instanceof Error ? error.cause : undefined;
        return connector instanceof ConnectorError && connector.cause instanceof EngineBridgeError && connector.cause.Code === code;
    }

    public async dispose(): Promise<void>
    {
        await this.Engine.dispose();
        await this.catalog.Dispose();
    }
}

/**
 * A connector over the Optimistic customers binding and the real SqlAdapter on a RecordingSqlSession: every read answers
 * `rows` (customer 7 at version 3 by default) and every statement reports `affected` rows.
 */
class SqlHarness
{
    public readonly Plan = Fx.Plan(Fx.OptimisticBinding());
    public readonly Identity = Fx.Identity(this.Plan);
    public readonly Connector: DataSourceConnector;

    private constructor(public readonly Session: RecordingSqlSession)
    {
        this.Connector = new DataSourceConnector(this.Plan, new SqlAdapter(Session), this.Identity);
    }

    public static Over(affected: number, rows: ExternalRecord[] = [{ ...Fx.Record(7, Fx.Acme, Fx.TeamA), [Fx.RevField]: 3 }]): SqlHarness
    {
        return new SqlHarness(new RecordingSqlSession(rows, affected));
    }

    public Id(storageId: string): string
    {
        return this.Identity.Mint(this.Plan.Bindings[0]!, storageId);
    }

    public async Applied(...changes: ConnectorChange[]): Promise<IConnectorTransaction>
    {
        const txn = await this.Connector.Begin(ConnectorContext.Anonymous);
        await txn.Apply(WriteHarness.Changes(...changes));
        return txn;
    }
}

/**
 * A connector over a customers binding and a recording adapter in partial-update mode, wrapped in VersionBumpingAdapter
 * as DataSourceAdapterCatalog wraps every adapter; with change builders.
 */
class WriteHarness
{
    public static readonly S3 = '3';
    public static readonly S7 = '7';
    public static readonly S8 = '8';
    public static readonly S9 = '9';
    public static readonly NewName = 'N';
    public static readonly Unsafe = '9007199254740993';
    public static readonly Padded = '007';
    public static readonly Int64Max = '9223372036854775807';
    public static readonly BeyondInt64 = '9223372036854775808';
    public static readonly Other = 'Other';
    public static readonly Beta = 'Beta';
    public static readonly Owner = 'other.Model';
    public static readonly Unmapped = 'unmapped';
    public static readonly Since = 'since';
    public static readonly DeleteFrom = 'DELETE FROM ';
    public static readonly GuardedDelete = 'DELETE FROM "customers" WHERE "cust_id" = $1 AND "rev" = $2';
    public static readonly Alice = 'alice';
    public static readonly Bob = 'bob';
    public static readonly Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    public readonly Plan: IExternalConnectorPlan;
    public readonly Identity: ExternalIdentity;
    public readonly Connector: DataSourceConnector;

    public constructor(public readonly Adapter: RecordingAdapter, binding: IExternalBinding)
    {
        Adapter.PartialUpserts = true;
        this.Plan = Fx.Plan(binding);
        this.Identity = Fx.Identity(this.Plan);
        this.Connector = new DataSourceConnector(this.Plan, new VersionBumpingAdapter(Adapter), this.Identity);
    }

    public static Over(records: ExternalRecord[] = [], overrides: Partial<ConnectorBinding> = {}): WriteHarness
    {
        return new WriteHarness(Fx.Adapter(records), Fx.BindingWith(overrides));
    }

    /** Customer 7 (Acme, team a) at version 3, under the Optimistic binding. */
    public static Optimistic(): WriteHarness
    {
        return new WriteHarness(Fx.Adapter([{ ...Fx.Record(7, Fx.Acme, Fx.TeamA), [Fx.RevField]: 3 }]), Fx.OptimisticBinding());
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

    /** `change` as the engine routes it after the transaction fetched its row at `version` (R119 V2). */
    public static Read(change: ConnectorChange, version: RowVersion): ConnectorChange
    {
        return { ...change, ExpectedVersion: version };
    }

    /** Moves customer 7's version on to `version`, as another writer would. */
    public async Bump(version: number): Promise<void>
    {
        await this.Adapter.Inner.Apply({
            Source: Fx.Source, IdKey: Fx.IdKey, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [{ Kind: WriteOperationKind.Upsert, Key: 7, Fields: { ...Fx.Record(7, Fx.Acme, Fx.TeamA), [Fx.RevField]: version } }],
        });
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

    /** A transaction with `changes` applied, on the anonymous context. */
    public Applied(...changes: ConnectorChange[]): Promise<IConnectorTransaction>
    {
        return this.AppliedAs(ConnectorContext.Anonymous, ...changes);
    }

    /** A transaction begun on `context` with `changes` applied. */
    public async AppliedAs(context: ConnectorContext, ...changes: ConnectorChange[]): Promise<IConnectorTransaction>
    {
        const txn = await this.Connector.Begin(context);
        await txn.Apply(WriteHarness.Changes(...changes));
        return txn;
    }

    /** The key of the row a recorded before-image read asks for. */
    public QueriedKey(index: number): unknown
    {
        return this.Adapter.Queries[index]!.Where?.All[0]?.Values?.[0];
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

    public static Throws(body: () => unknown, code: EngineBridgeErrorCode): void
    {
        assert.throws(body, (e: unknown) => e instanceof EngineBridgeError && e.Code === code);
    }

    /** Existing customers 7 (Acme, team a) and 8 (Beta, no team). */
    public static Existing(): ExternalRecord[]
    {
        return [Fx.Record(7, Fx.Acme, Fx.TeamA, true), Fx.Record(8, WriteHarness.Beta, null, false)];
    }

    /** The rows of the source sorted by key. */
    public async Rows(): Promise<ExternalRecord[]>
    {
        return [...await Fx.Rows(this.Adapter)].sort((a, b) => Number(a[Fx.IdKey]) - Number(b[Fx.IdKey]));
    }

    /** Creates 9 and renames the existing 7 and 8, in that order. */
    public NewAndTwoExisting(): ConnectorChange[]
    {
        const [n, a, b] = [this.Id(WriteHarness.S9), this.Id(WriteHarness.S7), this.Id(WriteHarness.S8)];
        return [
            WriteHarness.Create(n), WriteHarness.Set(n, Fx.Name, WriteHarness.NewName),
            WriteHarness.Set(a, Fx.Name, WriteHarness.NewName),
            WriteHarness.Set(b, Fx.Name, WriteHarness.NewName),
        ];
    }
}

describe('DataSourceConnector write side', () =>
{
    test('create sets merge into one upsert', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id(WriteHarness.S7);
        assert.deepEqual(h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName), WriteHarness.Link(x, Fx.TeamA)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.IdKey]: 7, [Fx.NameField]: WriteHarness.NewName, [Fx.TeamField]: Fx.TeamA } },
        ]);
    });

    test('a numeric id member set on a create agrees with the key', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id(WriteHarness.S7);
        assert.deepEqual(h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Id, 7n)), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.IdKey]: 7 } },
        ]);
        WriteHarness.Throws(() => h.Operations(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Id, 8n)), EngineBridgeErrorCode.UnsupportedExternalChange);
    });

    test('a create with a numeric id member needs a numeric key', async () =>
    {
        const h = WriteHarness.Over();
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Create(h.Id(randomUUID())))), EngineBridgeErrorCode.UnsupportedExternalChange);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('an Int64 id beyond 2^53 is created by its decimal text; a non-canonical numeric key is refused', () =>
    {
        const h = WriteHarness.Over();
        const big = h.Id(WriteHarness.Unsafe);
        assert.deepEqual(h.Operations(WriteHarness.Create(big), WriteHarness.Set(big, Fx.Id, BigInt(WriteHarness.Unsafe))), [
            { Kind: WriteOperationKind.Upsert, Key: WriteHarness.Unsafe, Fields: { [Fx.IdKey]: WriteHarness.Unsafe } },
        ]);
        WriteHarness.Throws(() => h.Operations(WriteHarness.Create(h.Id(WriteHarness.Padded))), EngineBridgeErrorCode.UnsupportedExternalChange);
    });

    test('an Int64 id outside the signed 64-bit range fails at Apply', async () =>
    {
        const h = WriteHarness.Over();
        const max = h.Id(WriteHarness.Int64Max);
        assert.deepEqual(h.Operations(WriteHarness.Create(max)), [{ Kind: WriteOperationKind.Upsert, Key: WriteHarness.Int64Max, Fields: { [Fx.IdKey]: WriteHarness.Int64Max } }]);
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Create(h.Id(WriteHarness.BeyondInt64)))), EngineBridgeErrorCode.UnsupportedExternalChange);
        assert.equal(h.Adapter.Calls, 0);
    });

    test('unlink clears the foreign key', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id(WriteHarness.S7);
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
        const x = h.Id(WriteHarness.S7);
        const batches = ChangeBatcher.Batches(
            WriteHarness.Changes(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName), WriteHarness.Delete(x)), h.Identity, Fx.Connector);
        assert.deepEqual(batches, []);
    });

    test('delete becomes delete', () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id(WriteHarness.S7);
        assert.deepEqual(h.Operations(WriteHarness.Unlink(x, Fx.TeamA), WriteHarness.Delete(x)), [{ Kind: WriteOperationKind.Delete, Key: 7, Fields: {} }]);
    });

    test('delete then create of an existing id keeps nothing of the deleted row', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const x = h.Id(WriteHarness.S7);
        const changes = [WriteHarness.Delete(x), WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName)];
        assert.deepEqual(h.Operations(...changes), [
            { Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.IdKey]: 7, [Fx.NameField]: WriteHarness.NewName, [Fx.TeamField]: null, [Fx.ActiveField]: null } },
        ]);
        const txn = await h.Applied(...changes);
        await txn.Commit();
        assert.deepEqual((await h.Rows())[0], { [Fx.IdKey]: 7, [Fx.NameField]: WriteHarness.NewName, [Fx.TeamField]: null, [Fx.ActiveField]: null });
    });

    test('a create of a key the source already holds is a conflict', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await h.Rows();
        const x = h.Id(WriteHarness.S7);
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        // Immediate: the create-conflict is caught at Apply, before any adapter write.
        const error = await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Create(x), WriteHarness.Set(x, Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.ExternalWriteFailed);
        assert.ok(error instanceof ExternalWriteError);
        assert.deepEqual(error.Failures.map(f => [f.Key, f.Kind]), [[7, WriteFailureKind.Conflict]]);
        assert.equal(h.Adapter.Batches.length, 0);
        await txn.Revert();
        assert.deepEqual(await h.Rows(), before);
    });

    test('ops on several ids keep the order of first appearance in one batch per binding', () =>
    {
        const h = WriteHarness.Over();
        const [a, b] = [h.Id(WriteHarness.S8), h.Id(WriteHarness.S7)];
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
        assert.equal(batches[0]!.Creates.size, 0);
    });

    test('apply refuses what it cannot express', async () =>
    {
        const h = WriteHarness.Over();
        const x = h.Id(WriteHarness.S7);
        const refused: [ConnectorChange, EngineBridgeErrorCode][] = [
            [{ Op: WriteOp.SetOwner, PublicId: x, Owner: WriteHarness.Owner, Concept: Fx.Customer }, EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(x, WriteHarness.Unmapped, 1n), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(x, Fx.Id, 9n), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Link(x, Fx.TeamA, new Map<string, CellValue>([[WriteHarness.Since, 1n]])), EngineBridgeErrorCode.UnsupportedExternalChange],
            [WriteHarness.Set(Fx.TeamA, Fx.Name, WriteHarness.NewName), EngineBridgeErrorCode.ForeignId],
        ];
        for (const [change, code] of refused)
        {
            const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
            await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(change)), code);
        }
        const readOnly = WriteHarness.Over([], { Writable: false });
        const txn = await readOnly.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(readOnly.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.NotWritable);
        // Apply alone touched nothing: it only translates and validates.
        assert.equal(h.Adapter.Calls + readOnly.Adapter.Calls, 0);
    });

    test('transactional binding needs a transacting adapter', async () =>
    {
        const h = WriteHarness.Over([], { Atomicity: WriteAtomicity.Transactional });
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.UnsupportedExternalChange);
        h.Adapter.CanTransact = true;
        const ok = await h.Applied(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        await ok.Commit();
        assert.equal(h.Adapter.Batches.length, 1);
    });

    test('apply executes the step', async () =>
    {
        // Apply runs adapter.Apply now and reports the reported versions, keyed by public id.
        const h = WriteHarness.Optimistic();
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const result = await txn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), 3)));
        assert.equal(h.Adapter.Batches.length, 1);
        // VersionBumpingAdapter bumped rev 3 -> 4 and reported it, mapped back to the public id.
        assert.equal((result as { Versions?: ReadonlyMap<string, RowVersion> }).Versions?.get(h.Id(WriteHarness.S7)), 4);
    });

    test('undo compensates only the latest step', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName)));  // step 1
        await txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S8), Fx.Name, WriteHarness.NewName)));  // step 2
        const applyCalls = h.Adapter.Batches.length;
        await txn.Undo!();  // undoes step 2 only
        const rows = await h.Rows();
        assert.equal(rows.find(r => r[Fx.IdKey] === 8)![Fx.NameField], WriteHarness.Beta);
        assert.equal(rows.find(r => r[Fx.IdKey] === 7)![Fx.NameField], WriteHarness.NewName);
        assert.equal(h.Adapter.Batches.length, applyCalls + 1);  // one compensation batch
    });

    test('per-op failure throws ExternalWriteError', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        h.Adapter.FailAfter = 0;
        h.Adapter.FailKind = WriteFailureKind.Conflict;
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const error = await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.ExternalWriteFailed);
        assert.ok(error instanceof ExternalWriteError);
        assert.equal(error.Binding, h.Plan.Bindings[0]);
        assert.equal(error.Failures[0]!.Key, 7);
        assert.equal(error.Failures[0]!.Kind, WriteFailureKind.Conflict);
    });

    test('partial sequential batch is compensated', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await h.Rows();
        h.Adapter.FailAfter = 2;
        // One new key (9) and two existing ones (7, 8); the source applies 9 and 7, then fails 8, at Apply.
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(...h.NewAndTwoExisting())), EngineBridgeErrorCode.ExternalWriteFailed);
        assert.equal((await h.Rows()).length, 3);
        await txn.Revert();
        assert.deepEqual(await h.Rows(), before);
        // Compensation in reverse order of what applied: 7 restored, then 9 deleted; 8 never applied.
        const compensation = h.Adapter.Batches.slice(1).flatMap(b => b.Operations);
        assert.deepEqual(compensation.map(o => [o.Kind, o.Key]), [[WriteOperationKind.Upsert, 7], [WriteOperationKind.Delete, 9]]);
    });

    test('a batch whose adapter call throws before anything applied is undone harmlessly', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await h.Rows();
        h.Adapter.ThrowAtCall = 2;
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Create(h.Id(WriteHarness.S9)), WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName))));
        await txn.Revert();
        assert.deepEqual(await h.Rows(), before);
    });

    test('a batch whose adapter call throws partway is compensated', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await h.Rows();
        h.Adapter.ThrowAfter = 2;
        // 9 is created and 7 renamed, then the driver dies before 8, at Apply.
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(txn.Apply(WriteHarness.Changes(...h.NewAndTwoExisting())));
        const midway = await h.Rows();
        assert.deepEqual(midway.map(r => [r[Fx.IdKey], r[Fx.NameField]]), [[7, WriteHarness.NewName], [8, WriteHarness.Beta], [9, WriteHarness.NewName]]);
        await txn.Revert();
        // Every op counts as applied: 8 is restored to the row it still is, 7 restored, 9 deleted.
        assert.deepEqual(await h.Rows(), before);
        const compensation = h.Adapter.Batches.slice(1).flatMap(b => b.Operations);
        assert.deepEqual(compensation.map(o => [o.Kind, o.Key]), [[WriteOperationKind.Upsert, 8], [WriteOperationKind.Upsert, 7], [WriteOperationKind.Delete, 9]]);
    });

    test('transactional binding is atomic per step', async () =>
    {
        // A Transactional binding's failed step applied nothing (atomic), so its compensation issues no adapter call.
        const h = WriteHarness.Over(WriteHarness.Existing(), { Atomicity: WriteAtomicity.Transactional });
        h.Adapter.CanTransact = true;
        h.Adapter.FailAfter = 0;
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName))), EngineBridgeErrorCode.ExternalWriteFailed);
        const calls = h.Adapter.Calls;
        await txn.Revert();
        assert.equal(h.Adapter.Calls, calls);
    });

    test('revert undoes every remaining step in reverse', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const before = await h.Rows();
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        // Step 1 creates 9; step 2 renames 7.
        await txn.Apply(WriteHarness.Changes(WriteHarness.Create(h.Id(WriteHarness.S9)), WriteHarness.Set(h.Id(WriteHarness.S9), Fx.Name, WriteHarness.NewName)));
        await txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName)));
        assert.deepEqual((await h.Rows()).map(r => r[Fx.IdKey]), [7, 8, 9]);
        await txn.Revert();
        assert.deepEqual(await h.Rows(), before);
        // Reverse: step 2's rename of 7 restored, then step 1's create of 9 deleted.
        const compensation = h.Adapter.Batches.slice(2).flatMap(b => b.Operations);
        assert.deepEqual(compensation.map(o => [o.Kind, o.Key]), [[WriteOperationKind.Upsert, 7], [WriteOperationKind.Delete, 9]]);
    });

    test('commit only finalizes', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const txn = await h.Applied(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        const calls = h.Adapter.Calls;
        await txn.Commit();
        // Finalize only: Commit makes no further adapter call; the write already happened at Apply.
        assert.equal(h.Adapter.Calls, calls);
        assert.equal((await h.Rows()).find(r => r[Fx.IdKey] === 7)![Fx.NameField], WriteHarness.NewName);
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, Fx.Acme))), EngineBridgeErrorCode.TransactionClosed);
    });

    test('optimistic binding guards with the before-image version', async () =>
    {
        const h = WriteHarness.Optimistic();
        const txn = await h.Applied(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        await txn.Commit();
        const batch = h.Adapter.Batches[0]!;
        assert.equal(batch.Concurrency, WriteConcurrency.Optimistic);
        assert.equal(batch.VersionField, Fx.RevField);
        assert.equal(batch.Operations[0]!.Version, 3);
        // The before-image read: IdKey in the batch keys, over every mapped field and the version field.
        const read = h.Adapter.Queries[0]!;
        assert.deepEqual(read.Where, { All: [{ Field: Fx.IdKey, Op: QueryCompareOp.In, Value: null, Values: [7] }] });
        assert.ok(read.Fields.includes(Fx.RevField) && read.Fields.includes(Fx.TeamField));
        assert.equal((await h.Rows())[0]![Fx.RevField], 4);
    });

    test('the version member can be written, guarded by the before-image version', async () =>
    {
        const h = WriteHarness.Optimistic();
        const x = h.Id(WriteHarness.S7);
        assert.deepEqual(h.Operations(WriteHarness.Set(x, Fx.Revision, 5n)), [{ Kind: WriteOperationKind.Upsert, Key: 7, Fields: { [Fx.RevField]: 5 } }]);
        const txn = await h.Applied(WriteHarness.Set(x, Fx.Revision, 5n));
        await txn.Commit();
        assert.equal(h.Adapter.Batches[0]!.Operations[0]!.Version, 3);
        assert.equal((await h.Rows())[0]![Fx.RevField], 5);
    });

    test('optimistic compensation moves the version forward and refuses a concurrent change', async () =>
    {
        const h = WriteHarness.Optimistic();
        const txn = await h.Applied(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        await txn.Revert();
        const compensation = h.Adapter.Batches[1]!;
        assert.equal(compensation.Concurrency, WriteConcurrency.Optimistic);
        assert.equal(compensation.Operations[0]!.Version, 4);
        assert.deepEqual((await h.Rows())[0], { ...Fx.Record(7, Fx.Acme, Fx.TeamA), [Fx.RevField]: 5 });

        const raced = WriteHarness.Optimistic();
        const second = await raced.Applied(WriteHarness.Set(raced.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        // Another writer changes the row after the write (its version moves on to 9).
        await raced.Adapter.Inner.Apply({
            Source: Fx.Source, IdKey: Fx.IdKey, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [{ Kind: WriteOperationKind.Upsert, Key: 7, Fields: { ...Fx.Record(7, WriteHarness.Other, null), [Fx.RevField]: 9 } }],
        });
        await WriteHarness.Rejects(second.Revert(), EngineBridgeErrorCode.CompensationFailed);
        assert.equal((await raced.Rows())[0]![Fx.NameField], WriteHarness.Other);
    });

    test('optimistic write uses the expected version', async () =>
    {
        const h = WriteHarness.Optimistic();
        const change = WriteHarness.Read(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), 3n);
        const batch = ChangeBatcher.Batches(WriteHarness.Changes(change), h.Identity, Fx.Connector)[0]!;
        assert.equal(batch.Expected.get(batch.Batch.Operations[0]!), 3);
        // The read version '3' passes the text pre-check against the before-image's 3, and is what guards the write.
        const sql = SqlHarness.Over(1);
        const txn = await sql.Applied(WriteHarness.Read(WriteHarness.Set(sql.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), WriteHarness.S3));
        await txn.Commit();
        const upsert = sql.Session.calls[sql.Session.calls.length - 1]!;
        assert.equal(upsert.params[upsert.params.length - 1], WriteHarness.S3);
    });

    test('optimistic write after a concurrent change fails with a version conflict', async () =>
    {
        const h = WriteHarness.Optimistic();
        // The transaction read version 3; another writer moved the row on to 4 before the write.
        await h.Bump(4);
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), 3))), (e: unknown) => e instanceof ExternalVersionConflict && e instanceof ConflictError
            && e.Binding === h.Plan.Bindings[0] && e.Failures[0]!.Kind === WriteFailureKind.Conflict);
        assert.equal(h.Adapter.Batches.length, 0);
        assert.equal((await h.Rows())[0]![Fx.NameField], Fx.Acme);
    });

    test('adapter conflict is a version conflict', async () =>
    {
        const h = WriteHarness.Optimistic();
        h.Adapter.FailAfter = 0;
        h.Adapter.FailKind = WriteFailureKind.Conflict;
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(txn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), 3))), (e: unknown) => e instanceof ExternalVersionConflict);
        assert.equal(h.Adapter.Batches.length, 1);
    });

    test('no expected version falls back to the before-image', async () =>
    {
        // V3: a write with nothing read (System scope) is guarded with the before-image; deletes carry it too (G1). A
        // delete of a row the before-image does not hold is dropped: nothing to delete, and no unretryable Conflict.
        const sql = SqlHarness.Over(1);
        const txn = await sql.Applied(WriteHarness.Delete(sql.Id(WriteHarness.S7)), WriteHarness.Delete(sql.Id(WriteHarness.S9)));
        await txn.Commit();
        const deletes = sql.Session.calls.filter(c => c.sql.startsWith(WriteHarness.DeleteFrom));
        assert.deepEqual(deletes.map(c => [c.sql, c.params]), [[WriteHarness.GuardedDelete, [7, 3]]]);
        // Only an absent row, nothing read: the commit succeeds after the before-image read alone.
        const absent = SqlHarness.Over(0, []);
        const gone = await absent.Applied(WriteHarness.Delete(absent.Id(WriteHarness.S9)));
        await gone.Commit();
        assert.equal(absent.Session.calls.length, 1);
    });

    test('last-write-wins ignores expected versions', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const txn = await h.Applied(WriteHarness.Read(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName), 99));
        await txn.Commit();
        assert.equal(h.Adapter.Batches[0]!.Operations[0]!.Version, undefined);
        assert.equal((await h.Rows())[0]![Fx.NameField], WriteHarness.NewName);
    });

    test('optimistic delete with a stale version conflicts', async () =>
    {
        // Pre-check: the transaction read version 2, the before-image holds 3; nothing is sent and the row remains.
        const stale = WriteHarness.Optimistic();
        const staleTxn = await stale.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(staleTxn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Delete(stale.Id(WriteHarness.S7)), 2))), (e: unknown) => e instanceof ExternalVersionConflict);
        assert.equal(stale.Adapter.Batches.length, 0);
        assert.equal((await stale.Rows()).length, 1);
        // A row read at a version and gone by the write is a conflict too.
        const goneTxn = await stale.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(goneTxn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Delete(stale.Id(WriteHarness.S9)), 2))), (e: unknown) => e instanceof ExternalVersionConflict);
        // SQL: the pre-check passed (before-image at 3), but the row changed before the guarded DELETE matched it.
        const sql = SqlHarness.Over(0);
        const sqlTxn = await sql.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(sqlTxn.Apply(WriteHarness.Changes(WriteHarness.Read(WriteHarness.Delete(sql.Id(WriteHarness.S7)), 3))), (e: unknown) => e instanceof ExternalVersionConflict);
        const deleted = sql.Session.calls[sql.Session.calls.length - 1]!;
        assert.equal(deleted.sql, WriteHarness.GuardedDelete);
        assert.deepEqual(deleted.params, [7, 3]);
    });

    test('a transaction forwards its Begin context to the before-image read and Apply', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const alice = ConnectorContext.For(WriteHarness.Alice);
        const txn = await h.AppliedAs(alice, WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        await txn.Commit();
        assert.deepEqual([h.Adapter.QueryContexts, h.Adapter.BatchContexts], [[alice], [alice]]);
    });

    test('compensation runs on the transaction context', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        h.Adapter.FailAfter = 2;
        const txn = await h.Connector.Begin(ConnectorContext.For(WriteHarness.Alice));
        await WriteHarness.Rejects(txn.Apply(WriteHarness.Changes(...h.NewAndTwoExisting())), EngineBridgeErrorCode.ExternalWriteFailed);
        await txn.Revert();
        // The failing batch, then its compensation: both on the transaction's context.
        assert.equal(h.Adapter.BatchContexts.length, 2);
        assert.deepEqual(h.Adapter.BatchContexts.map(c => c?.Key), [WriteHarness.Alice, WriteHarness.Alice]);
    });

    test('two transactions keep their contexts apart', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        const owners = new Map<unknown, string>([[7, WriteHarness.Alice], [8, WriteHarness.Bob]]);
        const [alice, bob] = await Promise.all([
            h.AppliedAs(ConnectorContext.For(WriteHarness.Alice), WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName)),
            h.AppliedAs(ConnectorContext.For(WriteHarness.Bob), WriteHarness.Set(h.Id(WriteHarness.S8), Fx.Name, WriteHarness.NewName)),
        ]);
        await Promise.all([alice.Commit(), bob.Commit()]);
        assert.equal(h.Adapter.Batches.length, 2);
        h.Adapter.Batches.forEach((b, i) => assert.equal(h.Adapter.BatchContexts[i]?.Key, owners.get(b.Operations[0]!.Key)));
        h.Adapter.QueryContexts.forEach((c, i) => assert.equal(c?.Key, owners.get(h.QueriedKey(i))));
        assert.equal(h.Adapter.QueryContexts.length, 2);
    });

    test('failed compensation throws CompensationFailed', async () =>
    {
        const h = WriteHarness.Over(WriteHarness.Existing());
        // Apply executes now: call 1 before-image read, call 2 apply.
        const txn = await h.Applied(WriteHarness.Set(h.Id(WriteHarness.S7), Fx.Name, WriteHarness.NewName));
        // Call 3 is the compensating apply.
        h.Adapter.ThrowAtCall = 3;
        const error = await WriteHarness.Rejects(txn.Revert(), EngineBridgeErrorCode.CompensationFailed);
        assert.ok(error instanceof ExternalWriteError);
        assert.equal(error.Binding, h.Plan.Bindings[0]);
    });

    test('engine write-through', async () =>
    {
        // Numeric id member: a create gives its id; one without an id value is refused at Apply and writes nothing.
        const numeric = await EngineHarness.Open(Fx.Binding());
        try
        {
            const result = await numeric.Execute(EngineHarness.CreateWithId);
            assert.deepEqual(await Fx.Rows(numeric.Adapter), [{ [Fx.IdKey]: 9, [Fx.NameField]: WriteHarness.NewName }]);
            const node = result.Rows[0]![0] as Cypher.NodeValue;
            assert.deepEqual(numeric.Identity.Parse(node.Id), { Binding: numeric.Plan.Bindings[0], StorageId: WriteHarness.S9 });
            await assert.rejects(numeric.Execute(EngineHarness.CreateNamed), (e: unknown) => EngineHarness.ConnectorCause(e, EngineBridgeErrorCode.UnsupportedExternalChange));
            assert.equal((await Fx.Rows(numeric.Adapter)).length, 1);
        }
        finally
        {
            await numeric.dispose();
        }
        // No id member mapped: the create lands with a UUID key, and its public id parses under the binding.
        const { [Fx.Id]: _id, ...unkeyed } = Fx.Binding().Binding.FieldMap;
        const keyless = await EngineHarness.Open(Fx.BindingWith({ FieldMap: unkeyed }));
        try
        {
            const result = await keyless.Execute(EngineHarness.CreateNamed);
            const rows = await Fx.Rows(keyless.Adapter);
            assert.equal(rows.length, 1);
            const key = rows[0]![Fx.IdKey];
            assert.match(key as string, WriteHarness.Uuid);
            assert.equal(rows[0]![Fx.NameField], WriteHarness.NewName);
            const node = result.Rows[0]![0] as Cypher.NodeValue;
            assert.deepEqual(keyless.Identity.Parse(node.Id), { Binding: keyless.Plan.Bindings[0], StorageId: key });
        }
        finally
        {
            await keyless.dispose();
        }
    });
});

/**
 * A source-key-assigning adapter fake (ruling R139 E9): Apply records insert batches and reports a scripted Assigned
 * (default serials 1.. in op order), and Query answers the re-read from `Rows`, keyed by IdKey text.
 */
class AssigningAdapter implements IDataSourceAdapter
{
    public readonly Batches: WriteBatch[] = [];
    public readonly Queries: QueryRequest[] = [];
    public CanAssignKeys = true;
    public CanTransact = false;
    /** The Assigned the next insert Apply reports, by Ref; undefined -> serials 1.. in op order. */
    public Script: IAssignedKey[] | undefined;
    public readonly Rows = new Map<string, ExternalRecord>();

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        this.Queries.push(request);
        const values = request.Where?.All[0]?.Values ?? [];
        return values.map(v => this.Rows.get(String(v))).filter((r): r is ExternalRecord => r !== undefined);
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        this.Batches.push(batch);
        if (batch.Operations[0]?.Kind === WriteOperationKind.Insert)
        {
            const assigned = this.Script ?? batch.Operations.map((op, i) => ({ Ref: op.Ref!, Key: i + 1 }));
            return { Applied: assigned.length, Failures: [], Assigned: assigned };
        }
        return { Applied: batch.Operations.length, Failures: [] };
    }

    public async Dispose(): Promise<void>
    {
    }

    /** Every Delete op issued across all Apply calls (the compensation), by key. */
    public DeletedKeys(): unknown[]
    {
        return this.Batches.flatMap(b => b.Operations).filter(o => o.Kind === WriteOperationKind.Delete).map(o => o.Key);
    }
}

/**
 * A source-keyed adapter whose insert Apply really applies the rows (serials, into an inner InMemoryAdapter) and THEN
 * throws, carrying on the error the keys it assigned — the production case of a driver that dies after inserting.
 * Deletes (compensation) go through to the inner adapter.
 */
class ThrowingInsertAdapter implements IDataSourceAdapter
{
    public static readonly Boom = 'driver died after inserting';
    public readonly Inner = new InMemoryAdapter();
    public CanAssignKeys = true;

    public Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return this.Inner.Query(request);
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        if (batch.Operations[0]?.Kind === WriteOperationKind.Insert)
        {
            const result = await this.Inner.Apply(batch);
            throw Object.assign(new Error(ThrowingInsertAdapter.Boom), { Assigned: result.Assigned });
        }
        return this.Inner.Apply(batch);
    }

    public async Dispose(): Promise<void>
    {
    }
}

/** A connector over a source-keyed binding and `adapter`, with request builders for source-keyed creates. */
class CreateHarness
{
    public readonly Plan: IExternalConnectorPlan;
    public readonly Identity: ExternalIdentity;
    public readonly Connector: DataSourceConnector;

    public constructor(public readonly Adapter: IDataSourceAdapter, binding: IExternalBinding)
    {
        this.Plan = Fx.Plan(binding);
        this.Identity = Fx.Identity(this.Plan);
        this.Connector = new DataSourceConnector(this.Plan, Adapter, this.Identity);
    }

    public Id(storageId: string): string
    {
        return this.Identity.Mint(this.Plan.Bindings[0]!, storageId);
    }

    public static Request(properties: Record<string, CellValue>): IAssignedCreate
    {
        return { Owner: Fx.Model, Concept: Fx.Customer, Properties: new Map(Object.entries(properties)), Links: [] };
    }
}

describe('DataSourceConnector source-keyed creates', () =>
{
    test('create inserts and returns the re-read row', async () =>
    {
        const h = new CreateHarness(new InMemoryAdapter(), Fx.OptimisticSourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([CreateHarness.Request({ [Fx.Name]: WriteHarness.NewName })]);
        assert.equal(outcomes.length, 1);
        const row = outcomes[0]!.Row!;
        assert.equal(row.PublicId, h.Id('1'));
        assert.equal(row.Values.get(Fx.Id), 1n);
        assert.equal(row.Values.get(Fx.Name), WriteHarness.NewName);
        assert.equal(row.Version, 1);
    });

    test('insert without a returned key fails with KeyNotAssigned and deletes nothing', async () =>
    {
        const adapter = new AssigningAdapter();
        adapter.Script = [];
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([CreateHarness.Request({ [Fx.Name]: WriteHarness.NewName })]);
        assert.equal(outcomes.length, 1);
        assert.ok(outcomes[0]!.Error instanceof ExternalWriteError);
        assert.equal((outcomes[0]!.Error as ExternalWriteError).Code, EngineBridgeErrorCode.KeyNotAssigned);
        await txn.Undo!();
        assert.deepEqual(adapter.DeletedKeys(), []);
    });

    test('source binding over an adapter without CanAssignKeys is unsupported', async () =>
    {
        const adapter = new AssigningAdapter();
        adapter.CanAssignKeys = false;
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await WriteHarness.Rejects(txn.Create!([CreateHarness.Request({ [Fx.Name]: WriteHarness.NewName })]), EngineBridgeErrorCode.UnsupportedExternalChange);
    });

    test('create undo deletes the assigned key', async () =>
    {
        const adapter = new AssigningAdapter();
        adapter.Script = [{ Ref: '0', Key: 1 }];
        adapter.Rows.set('1', { [Fx.IdKey]: 1, [Fx.NameField]: WriteHarness.NewName });
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([CreateHarness.Request({ [Fx.Name]: WriteHarness.NewName })]);
        assert.ok(outcomes[0]!.Row);
        await txn.Undo!();
        assert.deepEqual(adapter.DeletedKeys(), [1]);
    });

    test('create maps outcomes by Ref', async () =>
    {
        const adapter = new AssigningAdapter();
        // The source returns the assigned keys in reverse Ref order; outcomes stay index-aligned with the requests.
        adapter.Script = [{ Ref: '2', Key: 3 }, { Ref: '1', Key: 2 }, { Ref: '0', Key: 1 }];
        adapter.Rows.set('1', { [Fx.IdKey]: 1 });
        adapter.Rows.set('2', { [Fx.IdKey]: 2 });
        adapter.Rows.set('3', { [Fx.IdKey]: 3 });
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([
            CreateHarness.Request({ [Fx.Name]: 'a' }), CreateHarness.Request({ [Fx.Name]: 'b' }), CreateHarness.Request({ [Fx.Name]: 'c' })]);
        assert.deepEqual(outcomes.map(o => o.Row!.PublicId), [h.Id('1'), h.Id('2'), h.Id('3')]);
    });

    test('partial insert batch logs only applied refs', async () =>
    {
        const adapter = new AssigningAdapter();
        // Sequential: ref 1 of 3 is not assigned (failed); refs 0 and 2 are.
        adapter.Script = [{ Ref: '0', Key: 1 }, { Ref: '2', Key: 3 }];
        adapter.Rows.set('1', { [Fx.IdKey]: 1 });
        adapter.Rows.set('3', { [Fx.IdKey]: 3 });
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        const outcomes = await txn.Create!([
            CreateHarness.Request({ [Fx.Name]: 'a' }), CreateHarness.Request({ [Fx.Name]: 'b' }), CreateHarness.Request({ [Fx.Name]: 'c' })]);
        assert.deepEqual(outcomes.map(o => o.Row !== undefined), [true, false, true]);
        assert.ok(outcomes[1]!.Error instanceof ExternalWriteError);
        await txn.Undo!();
        assert.deepEqual([...adapter.DeletedKeys()].sort(), [1, 3]);

        // Transactional over a transacting adapter: nothing assigned, so all three are Error and Undo issues nothing.
        const atomic = new AssigningAdapter();
        atomic.CanTransact = true;
        atomic.Script = [];
        const th = new CreateHarness(atomic, Fx.SourceKeyed({ Atomicity: WriteAtomicity.Transactional }));
        const ttxn = await th.Connector.Begin(ConnectorContext.Anonymous);
        const touts = await ttxn.Create!([
            CreateHarness.Request({ [Fx.Name]: 'a' }), CreateHarness.Request({ [Fx.Name]: 'b' }), CreateHarness.Request({ [Fx.Name]: 'c' })]);
        assert.deepEqual(touts.map(o => o.Error !== undefined), [true, true, true]);
        await ttxn.Undo!();
        assert.deepEqual(atomic.DeletedKeys(), []);
    });

    test('create whose Apply throws after inserting still logs the applied rows for Undo', async () =>
    {
        // The production path: adapter.Apply inserts the rows, then the driver dies. The keys it assigned reach the
        // step's log before the throw surfaces, so Undo compensates them and nothing orphans.
        const adapter = new ThrowingInsertAdapter();
        const h = new CreateHarness(adapter, Fx.SourceKeyed());
        const txn = await h.Connector.Begin(ConnectorContext.Anonymous);
        await assert.rejects(
            txn.Create!([CreateHarness.Request({ [Fx.Name]: 'a' }), CreateHarness.Request({ [Fx.Name]: 'b' })]),
            (e: unknown) => e instanceof Error && e.message === ThrowingInsertAdapter.Boom);
        // Both rows were applied before the throw; they are now in the source.
        assert.equal((await adapter.Inner.Query({ Source: Fx.Source, Fields: [Fx.IdKey] })).length, 2);
        await txn.Undo!();
        // Undo deleted exactly the applied rows: nothing orphans.
        assert.deepEqual(await adapter.Inner.Query({ Source: Fx.Source, Fields: [Fx.IdKey] }), []);
    });
});
