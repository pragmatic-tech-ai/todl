import {
    ConnectorChangeSet,
    type ConnectorChange,
    type ConnectorContext,
    type IAssignedCreate,
    type IAssignedOutcome,
    type IConnectorApplyResult,
    type IConnectorTransaction,
    type IFetchedRow,
    type RowVersion,
} from '@pragmatic-tech-ai/graph';
import {
    KeyAssignment,
    QueryCompareOp,
    WriteAtomicity,
    WriteConcurrency,
    WriteFailureKind,
    WriteOperationKind,
    type ExternalFieldValue,
    type ExternalRecord,
    type IAssignedKey,
    type WriteBatch,
    type WriteFailure,
    type WriteOperation,
} from '../../model-data/connector-plan.js';
import type { IDataSourceAdapter } from '../../model-data/data-source-adapter.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { ChangeBatcher, type IPendingBatch } from './ChangeBatcher.js';
import type { IExternalBinding } from './ExternalBinding.js';
import { ExternalIdentity } from './ExternalIdentity.js';
import { ExternalValues } from './ExternalValues.js';
import { ExternalVersionConflict } from './ExternalVersionConflict.js';
import { ExternalWriteError } from './ExternalWriteError.js';
import { MappedMembers } from './FetchTranslator.js';

/** Builds an IFetchedRow from a source record (the fetch side's row builder), so Create can re-read what it inserted. */
export interface IExternalRowBuilder
{
    BuildRow(binding: IExternalBinding, record: ExternalRecord): IFetchedRow;
}

/** Consecutive compensating operations of one concurrency, sent as one sequential batch. */
interface IUndoRun
{
    readonly Guarded: boolean;
    readonly Operations: WriteOperation[];
}

/** Where a DataSourceTransaction is in its life. */
enum TransactionState
{
    /** Taking steps (Apply / Create) and able to Commit / Undo / Revert. */
    Open = 1,
    /** Commit finalized the transaction; before-images dropped. */
    Committed,
    /** Every remaining step compensated. */
    Reverted,
}

/** A batch applied in a step: its before-image and the operations that (may have) applied, for compensation. */
interface IAttemptedBatch
{
    readonly Binding: IExternalBinding;
    /** Before-image rows by key text; a key without one did not exist before the write (an insert has none). */
    readonly Before: ReadonlyMap<string, ExternalRecord>;
    Applied: readonly WriteOperation[];
    /** The version each applied upsert carries after the write, by key text, when the adapter reported it. */
    Versions: ReadonlyMap<string, ExternalFieldValue>;
}

/** One executed step: the batches it applied, compensated together (latest-first) by Undo / Revert. */
type Step = IAttemptedBatch[];

/** One request's place in the Create call: its binding, its global index (the Ref) and the insert built for it. */
interface ICreatePlan
{
    readonly Index: number;
    readonly Ref: string;
    readonly Binding: IExternalBinding;
    readonly Insert: WriteOperation;
}

/**
 * One engine transaction's writes to one DataSourceConnector (rulings T9, R139 E9). Immediate external writes: each
 * Apply or Create is a write STEP that executes at the source now, so a created record has its real public id at once
 * and a change is visible to others as soon as the source applies it. Only engine-stored data is transactional; an
 * engine abort or commit failure compensates the executed steps in reverse (E6, driven by the engine's Compensator,
 * which calls Undo per step, latest-first).
 *
 * Apply translates the step with ChangeBatcher (each step stands alone: no cross-Apply re-merge; ops on one id merge
 * within the step) and executes its batches in order. Per batch: read the before-image (inserts excluded), run the
 * create-conflict check (a create whose key the before-image holds is a Conflict, ExternalWriteFailed), run the
 * Optimistic version pre-check (ExpectedVersion against the before-image; a mismatch is ExternalVersionConflict before
 * any write), call adapter.Apply (deletes and upserts guarded with their version, R122 G1), and record the attempt
 * under the current step. Apply resolves with { Versions } from WriteResult.Versions, keyed by public id. A
 * Transactional binding whose adapter cannot transact is refused (UnsupportedExternalChange) before any remote effect.
 *
 * Create executes source-keyed inserts as one step (E9): each request's binding is resolved from (Owner, Concept) and
 * must be KeyAssignment.Source on an adapter with CanAssignKeys; one Insert per request (Key null, Ref the request
 * index, fields from Properties, foreign keys from Links); one WriteBatch per binding; the source reports
 * WriteResult.Assigned keyed by Ref; every assigned insert is logged for Undo (a Delete of its key) before the assigned
 * rows are re-read (one Query per binding) and returned as IFetchedRows. Outcomes are index-aligned: a Row when the row
 * came back, else an Error (KeyNotAssigned when no key names the Ref, a null/duplicate key, or an id over 400 bytes).
 *
 * Undo compensates the latest executed step not yet undone; Revert compensates every remaining step in reverse. Commit
 * only finalizes (state Committed, before-images dropped); it has no remote effect. A Transactional binding is atomic
 * per step. Compensation restores before-images last-write-wins (an Optimistic upsert whose committed version the
 * adapter reported is guarded with that version so the version moves forward, no ABA); a failed compensation throws
 * ExternalWriteError (CompensationFailed). Before-images live only as long as the transaction (spec §5.2, §12).
 */
export class DataSourceTransaction implements IConnectorTransaction
{
    private static readonly ErrClosed = 'The external transaction no longer takes this call: ';
    private static readonly ErrNoTransact = 'A transactional binding needs an adapter that can transact: ';
    private static readonly ErrWrite = 'External write failed on ';
    private static readonly ErrExists = 'A created external row already exists in the source';
    private static readonly ErrStale = 'External row changed since it was read on ';
    private static readonly ErrStaleRow = 'The row changed since this transaction read it';
    private static readonly ErrGoneRow = 'The row was removed since this transaction read it';
    private static readonly ErrCompensate = 'Compensating an external write failed on ';
    private static readonly ErrNoCreateBinding = 'No source-keyed binding is known for this owner and concept: ';
    private static readonly ErrNotSourceKeyed = 'A source-keyed create needs a `keys source` binding on an adapter that assigns keys: ';
    private static readonly ErrUnmappedMember = 'The create sets a member the external source does not map: ';
    private static readonly ErrKeyNotAssigned = 'The source assigned no key for an inserted row: ';
    private static readonly ErrNullKey = 'The source assigned a null key for an inserted row: ';
    private static readonly ErrDuplicateKey = 'The source assigned one key to two inserted rows: ';
    private static readonly ErrLongId = 'The minted public id of an inserted row exceeds the UTF-8 byte limit: ';
    private static readonly ErrMissingRow = 'An inserted row could not be re-read from the source: ';
    private static readonly SourceSeparator = '.';
    private static readonly MemberSeparator = '.';
    private static readonly OwnerSeparator = '/';
    private static readonly CountOpen = ' (';
    private static readonly CountClose = ' failed)';
    private static readonly MaxIdBytes = 400;

    private state = TransactionState.Open;
    /** The executed steps, oldest first; Undo pops the latest, Revert drains all in reverse. */
    private readonly steps: Step[] = [];

    public constructor(
        private readonly connector: string,
        private readonly adapter: IDataSourceAdapter,
        private readonly identity: ExternalIdentity,
        private readonly builder: IExternalRowBuilder,
        /** The Begin caller (one per transaction, S2 E11): the before-image read, every Apply and every compensation run on it. */
        private readonly context: ConnectorContext,
    )
    {
    }

    public async Apply(changes: ConnectorChangeSet): Promise<IConnectorApplyResult>
    {
        this.RequireState(TransactionState.Open);
        // Each step stands alone (R139 E9): translate only this change set, so ops on one id merge within the step only.
        const pending = ChangeBatcher.Batches(changes, this.identity, this.connector);
        for (const batch of pending)
        {
            if (batch.Binding.Binding.Atomicity === WriteAtomicity.Transactional && this.adapter.CanTransact !== true)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, DataSourceTransaction.ErrNoTransact + DataSourceTransaction.Where(batch.Binding));
            }
        }
        const step: Step = [];
        this.steps.push(step);
        const versions = new Map<string, RowVersion>();
        for (const batch of pending)
        {
            await this.Write(batch, step, versions);
        }
        return { Versions: versions };
    }

    public async Create(requests: readonly IAssignedCreate[]): Promise<readonly IAssignedOutcome[]>
    {
        this.RequireState(TransactionState.Open);
        const plans = requests.map((request, index) => this.Plan(request, index));
        const step: Step = [];
        this.steps.push(step);
        const assigned = new Map<string, IAssignedKey>();
        const reread = new Map<IExternalBinding, ExternalFieldValue[]>();
        // One Apply per binding. Log what each binding assigned for Undo the moment its Apply settles, so a later
        // binding's throw never orphans an earlier binding's rows, and so a throwing Apply that reports what it applied
        // before dying (IAssignedKey[] on the error) is still logged and compensable (ruling R139 E9, spec §5.3 E3).
        const seen = new Set<string>();
        for (const [binding, group] of DataSourceTransaction.ByBinding(plans))
        {
            const batch = DataSourceTransaction.InsertBatch(binding, group.map(p => p.Insert));
            let keys: readonly IAssignedKey[];
            try
            {
                keys = (await this.adapter.Apply(batch, this.context)).Assigned ?? [];
            }
            catch (error)
            {
                DataSourceTransaction.LogApplied(binding, DataSourceTransaction.AssignedOf(error), step, seen);
                throw error;
            }
            reread.set(binding, DataSourceTransaction.LogApplied(binding, keys, step, seen));
            for (const key of keys)
            {
                assigned.set(key.Ref, key);
            }
        }
        return this.Outcomes(plans, assigned, await this.RereadAll(reread));
    }

    public async Commit(): Promise<void>
    {
        this.RequireState(TransactionState.Open);
        this.state = TransactionState.Committed;
        // Finalize only: no remote effect, and the before-images are no longer needed.
        this.steps.length = 0;
    }

    /** Compensates the latest executed step not yet undone (the engine's Compensator calls this per step, latest-first). */
    public async Undo(): Promise<void>
    {
        const step = this.steps.pop();
        if (step === undefined)
        {
            return;
        }
        const failure = await this.CompensateStep(step);
        if (failure !== undefined)
        {
            throw failure;
        }
    }

    public async Revert(): Promise<void>
    {
        if (this.state === TransactionState.Reverted)
        {
            return;
        }
        this.state = TransactionState.Reverted;
        let first: ExternalWriteError | undefined;
        for (const step of this.steps.splice(0).reverse())
        {
            first ??= await this.CompensateStep(step);
        }
        if (first !== undefined)
        {
            throw first;
        }
    }

    /** Executes one Apply batch (before-image, create-conflict, version pre-check, adapter.Apply), recording its attempt under `step`. */
    private async Write(pending: IPendingBatch, step: Step, versions: Map<string, RowVersion>): Promise<void>
    {
        const binding = pending.Binding;
        const before = await this.BeforeImage(binding, pending.Batch);
        const existing: WriteFailure[] = pending.Batch.Operations
            .filter(o => pending.Creates.has(o) && before.has(DataSourceTransaction.KeyText(o.Key)))
            .map(o => ({ Key: o.Key, Kind: WriteFailureKind.Conflict, Reason: DataSourceTransaction.ErrExists }));
        if (existing.length > 0)
        {
            throw DataSourceTransaction.WriteFailed(binding, existing);
        }
        const stale = DataSourceTransaction.Stale(pending, before);
        if (stale.length > 0)
        {
            throw DataSourceTransaction.VersionConflict(binding, stale);
        }
        const batch = DataSourceTransaction.Guarded(binding, pending, before);
        if (batch.Operations.length === 0)
        {
            return;
        }
        const transacted = binding.Binding.Atomicity === WriteAtomicity.Transactional && this.adapter.CanTransact === true;
        const attempt: IAttemptedBatch = { Binding: binding, Before: before, Applied: batch.Operations, Versions: new Map() };
        step.push(attempt);
        let failures: readonly WriteFailure[];
        try
        {
            const result = await this.adapter.Apply(batch, this.context);
            failures = result.Failures;
            attempt.Versions = new Map((result.Versions ?? []).map(v => [DataSourceTransaction.KeyText(v.Key), v.Version]));
            for (const v of result.Versions ?? [])
            {
                const publicId = this.identity.Mint(binding, String(v.Key));
                const version = ExternalValues.ToVersion(v.Version, publicId);
                if (version !== undefined)
                {
                    versions.set(publicId, version);
                }
            }
        }
        catch (error)
        {
            if (transacted)
            {
                attempt.Applied = [];
            }
            throw error;
        }
        if (failures.length > 0)
        {
            const failed = new Set(failures.map(f => DataSourceTransaction.KeyText(f.Key)));
            attempt.Applied = transacted ? [] : batch.Operations.filter(o => !failed.has(DataSourceTransaction.KeyText(o.Key)));
            throw DataSourceTransaction.Optimistic(binding) && failures.some(f => f.Kind === WriteFailureKind.Conflict)
                ? DataSourceTransaction.VersionConflict(binding, failures)
                : DataSourceTransaction.WriteFailed(binding, failures);
        }
    }

    /** The binding, index and insert for one create request; throws when the request is not a source-keyed create it can express. */
    private Plan(request: IAssignedCreate, index: number): ICreatePlan
    {
        const binding = this.identity.Bindings().find(b => b.Model === request.Owner && b.Binding.Concept === request.Concept);
        if (binding === undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange,
                DataSourceTransaction.ErrNoCreateBinding + request.Owner + DataSourceTransaction.OwnerSeparator + request.Concept);
        }
        if (ExternalIdentity.KeyAssignmentOf(binding) !== KeyAssignment.Source || this.adapter.CanAssignKeys !== true)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange,
                DataSourceTransaction.ErrNotSourceKeyed + request.Owner + DataSourceTransaction.OwnerSeparator + request.Concept);
        }
        return { Index: index, Ref: String(index), Binding: binding, Insert: this.Insert(binding, request, String(index)) };
    }

    /** One Insert op for a create request: key null, fields from Properties (id member excluded), foreign keys from Links. */
    private Insert(binding: IExternalBinding, request: IAssignedCreate, ref: string): WriteOperation
    {
        const b = binding.Binding;
        const idMember = this.identity.IdMemberName(binding);
        const fields: Record<string, ExternalFieldValue> = {};
        for (const [member, cell] of request.Properties)
        {
            if (member === idMember)
            {
                continue;
            }
            const field = Object.hasOwn(b.FieldMap, member) ? b.FieldMap[member] : undefined;
            if (field === undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange,
                    DataSourceTransaction.ErrUnmappedMember + request.Concept + DataSourceTransaction.MemberSeparator + member);
            }
            fields[field] = cell === null ? null : ExternalValues.ToExternal(cell, request.Concept + DataSourceTransaction.MemberSeparator + member);
        }
        for (const link of request.Links)
        {
            const field = MappedMembers.Link(binding, link.Relationship, this.identity);
            if (field === undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange,
                    DataSourceTransaction.ErrUnmappedMember + request.Concept + DataSourceTransaction.MemberSeparator + link.Relationship);
            }
            fields[field] = this.identity.ForeignKey(binding, link.Relationship, link.To);
        }
        return { Kind: WriteOperationKind.Insert, Key: null, Ref: ref, Fields: fields };
    }

    /** Re-reads each binding's assigned rows (IdKey in the keys, over IdKey, mapped fields and the version field). */
    private async RereadAll(reread: ReadonlyMap<IExternalBinding, ExternalFieldValue[]>): Promise<Map<IExternalBinding, Map<string, ExternalRecord>>>
    {
        const rows = new Map<IExternalBinding, Map<string, ExternalRecord>>();
        for (const [binding, keys] of reread)
        {
            rows.set(binding, keys.length === 0 ? new Map() : await this.Reread(binding, keys));
        }
        return rows;
    }

    private async Reread(binding: IExternalBinding, keys: readonly ExternalFieldValue[]): Promise<Map<string, ExternalRecord>>
    {
        const b = binding.Binding;
        const fields = new Set<string>([b.IdKey, ...Object.values(b.FieldMap)]);
        if (b.VersionField !== undefined)
        {
            fields.add(b.VersionField);
        }
        const records = await this.adapter.Query({
            Source: b.Source,
            Fields: [...fields],
            Where: { All: [{ Field: b.IdKey, Op: QueryCompareOp.In, Value: null, Values: keys }] },
        }, this.context);
        const byKey = new Map<string, ExternalRecord>();
        for (const record of records)
        {
            byKey.set(DataSourceTransaction.KeyText(record[b.IdKey] ?? null), record);
        }
        return byKey;
    }

    /** One outcome per request, index-aligned: a Row when the assigned row came back, else the Error that disqualified it. */
    private Outcomes(plans: readonly ICreatePlan[], assigned: ReadonlyMap<string, IAssignedKey>, rows: ReadonlyMap<IExternalBinding, Map<string, ExternalRecord>>): IAssignedOutcome[]
    {
        const minted = new Set<string>();
        return plans.map(plan =>
        {
            const key = assigned.get(plan.Ref);
            if (key === undefined)
            {
                return { Error: DataSourceTransaction.WriteError(EngineBridgeErrorCode.KeyNotAssigned, DataSourceTransaction.ErrKeyNotAssigned + plan.Ref, plan.Binding) };
            }
            if (key.Key === null)
            {
                return { Error: DataSourceTransaction.WriteError(EngineBridgeErrorCode.KeyNotAssigned, DataSourceTransaction.ErrNullKey + plan.Ref, plan.Binding) };
            }
            const publicId = this.identity.Mint(plan.Binding, String(key.Key));
            if (minted.has(publicId))
            {
                return { Error: DataSourceTransaction.Invalid(DataSourceTransaction.ErrDuplicateKey + publicId) };
            }
            minted.add(publicId);
            if (Buffer.byteLength(publicId) > DataSourceTransaction.MaxIdBytes)
            {
                return { Error: DataSourceTransaction.Invalid(DataSourceTransaction.ErrLongId + publicId) };
            }
            const record = rows.get(plan.Binding)?.get(DataSourceTransaction.KeyText(key.Key));
            if (record === undefined)
            {
                return { Error: DataSourceTransaction.Invalid(DataSourceTransaction.ErrMissingRow + publicId) };
            }
            return { Row: this.builder.BuildRow(plan.Binding, record) };
        });
    }

    private static WriteError(code: EngineBridgeErrorCode.KeyNotAssigned, message: string, binding: IExternalBinding): ExternalWriteError
    {
        return new ExternalWriteError(code, message, binding, []);
    }

    private static Invalid(message: string): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, message);
    }

    /**
     * Records a binding's assigned inserts in `step` as compensating Deletes (de-duplicated by key across the call via
     * `seen`), so Undo removes exactly the rows this step applied. Returns the storage keys it logged (for the re-read).
     */
    private static LogApplied(binding: IExternalBinding, keys: readonly IAssignedKey[], step: Step, seen: Set<string>): ExternalFieldValue[]
    {
        const applied: WriteOperation[] = [];
        const stored: ExternalFieldValue[] = [];
        for (const key of keys)
        {
            if (key.Key === null || seen.has(DataSourceTransaction.KeyText(key.Key)))
            {
                continue;
            }
            seen.add(DataSourceTransaction.KeyText(key.Key));
            applied.push({ Kind: WriteOperationKind.Upsert, Key: key.Key, Fields: {} });
            stored.push(key.Key);
        }
        if (applied.length > 0)
        {
            step.push({ Binding: binding, Before: new Map(), Applied: applied, Versions: new Map() });
        }
        return stored;
    }

    /** The assigned keys a throwing Apply reports it applied before dying (an `Assigned` array on the error), else none. */
    private static AssignedOf(error: unknown): readonly IAssignedKey[]
    {
        return typeof error === 'object' && error !== null && Array.isArray((error as { Assigned?: unknown }).Assigned)
            ? (error as { Assigned: readonly IAssignedKey[] }).Assigned
            : [];
    }

    /** Requests grouped by binding, in first-appearance order; the group keeps each request's plan. */
    private static ByBinding(plans: readonly ICreatePlan[]): Map<IExternalBinding, ICreatePlan[]>
    {
        const groups = new Map<IExternalBinding, ICreatePlan[]>();
        for (const plan of plans)
        {
            const group = groups.get(plan.Binding);
            if (group === undefined)
            {
                groups.set(plan.Binding, [plan]);
            }
            else
            {
                group.push(plan);
            }
        }
        return groups;
    }

    private static InsertBatch(binding: IExternalBinding, operations: readonly WriteOperation[]): WriteBatch
    {
        const b = binding.Binding;
        const batch: WriteBatch = { Source: b.Source, IdKey: b.IdKey, Operations: operations, Concurrency: b.Concurrency, Atomicity: b.Atomicity };
        if (b.VersionField !== undefined)
        {
            batch.VersionField = b.VersionField;
        }
        return batch;
    }

    private static VersionConflict(binding: IExternalBinding, failures: readonly WriteFailure[]): ExternalVersionConflict
    {
        return new ExternalVersionConflict(
            DataSourceTransaction.ErrStale + DataSourceTransaction.Where(binding) + DataSourceTransaction.CountOpen + failures.length + DataSourceTransaction.CountClose,
            binding,
            failures);
    }

    /** True for an Optimistic binding with a version field: its writes are version-guarded. */
    private static Optimistic(binding: IExternalBinding): boolean
    {
        return binding.Binding.Concurrency === WriteConcurrency.Optimistic && binding.Binding.VersionField !== undefined;
    }

    /**
     * The version pre-check of an Optimistic batch (rulings R119 V2, R122 G1): a Conflict failure for each operation with
     * an expected version whose before-image row is missing or carries another version. Versions compare as text, as keys
     * do, so a source answering `'4'` for 4 still matches.
     */
    private static Stale(pending: IPendingBatch, before: ReadonlyMap<string, ExternalRecord>): WriteFailure[]
    {
        if (!DataSourceTransaction.Optimistic(pending.Binding))
        {
            return [];
        }
        const versionField = pending.Binding.Binding.VersionField!;
        const failures: WriteFailure[] = [];
        for (const op of pending.Batch.Operations)
        {
            const expected = pending.Expected.get(op);
            if (expected === undefined)
            {
                continue;
            }
            const row = before.get(DataSourceTransaction.KeyText(op.Key));
            const current = row === undefined ? undefined : row[versionField] ?? null;
            if (current === undefined)
            {
                failures.push({ Key: op.Key, Kind: WriteFailureKind.Conflict, Reason: DataSourceTransaction.ErrGoneRow });
            }
            else if (current === null || String(current) !== String(expected))
            {
                failures.push({ Key: op.Key, Kind: WriteFailureKind.Conflict, Reason: DataSourceTransaction.ErrStaleRow });
            }
        }
        return failures;
    }

    private static WriteFailed(binding: IExternalBinding, failures: readonly WriteFailure[]): ExternalWriteError
    {
        return new ExternalWriteError(
            EngineBridgeErrorCode.ExternalWriteFailed,
            DataSourceTransaction.ErrWrite + DataSourceTransaction.Where(binding) + DataSourceTransaction.CountOpen + failures.length + DataSourceTransaction.CountClose,
            binding,
            failures);
    }

    /** The current rows of the batch's keys (inserts excluded), over IdKey, every FieldMap field and the version field. */
    private async BeforeImage(binding: IExternalBinding, batch: WriteBatch): Promise<ReadonlyMap<string, ExternalRecord>>
    {
        const b = binding.Binding;
        const fields = new Set<string>([b.IdKey, ...Object.values(b.FieldMap)]);
        if (b.VersionField !== undefined)
        {
            fields.add(b.VersionField);
        }
        const keys = batch.Operations.filter(o => o.Kind !== WriteOperationKind.Insert && o.Key !== null).map(o => o.Key);
        const rows = keys.length === 0 ? [] : await this.adapter.Query({
            Source: b.Source,
            Fields: [...fields],
            Where: { All: [{ Field: b.IdKey, Op: QueryCompareOp.In, Value: null, Values: keys }] },
        }, this.context);
        const before = new Map<string, ExternalRecord>();
        for (const row of rows)
        {
            before.set(DataSourceTransaction.KeyText(row[b.IdKey] ?? null), row);
        }
        return before;
    }

    /**
     * The batch with each operation's Version, for an Optimistic binding with a version field: the version the
     * transaction read (IPendingBatch.Expected, ruling R119 V2), else the before-image's (V3: nothing was read, so nothing
     * can be stale). Deletes carry it too (R122 G1). A Delete with neither is dropped: nothing was read and the row is
     * already gone, so there is nothing to delete or guard (sent, it would be an unretryable Conflict). Any other
     * operation with neither (an upsert of a row the before-image does not hold) is left without one.
     */
    private static Guarded(binding: IExternalBinding, pending: IPendingBatch, before: ReadonlyMap<string, ExternalRecord>): WriteBatch
    {
        const batch = pending.Batch;
        if (!DataSourceTransaction.Optimistic(binding))
        {
            return batch;
        }
        const versionField = binding.Binding.VersionField!;
        const operations: WriteOperation[] = [];
        for (const o of batch.Operations)
        {
            const expected = pending.Expected.get(o);
            const row = before.get(DataSourceTransaction.KeyText(o.Key));
            if (expected !== undefined)
            {
                operations.push({ ...o, Version: expected });
            }
            else if (row !== undefined)
            {
                operations.push({ ...o, Version: row[versionField] ?? null });
            }
            else if (o.Kind !== WriteOperationKind.Delete)
            {
                operations.push(o);
            }
        }
        return { ...batch, Operations: operations };
    }

    /** Compensates one step's batches (latest-first); the first failure, else undefined. */
    private async CompensateStep(step: Step): Promise<ExternalWriteError | undefined>
    {
        let first: ExternalWriteError | undefined;
        for (const attempt of [...step].reverse())
        {
            for (const run of DataSourceTransaction.UndoRuns(attempt))
            {
                first ??= await this.UndoRun(attempt.Binding, run);
            }
        }
        return first;
    }

    /** Applies one run of compensating operations; the error describing a failure, else undefined. */
    private async UndoRun(binding: IExternalBinding, run: IUndoRun): Promise<ExternalWriteError | undefined>
    {
        const b = binding.Binding;
        const message = DataSourceTransaction.ErrCompensate + DataSourceTransaction.Where(binding);
        const batch: WriteBatch = { Source: b.Source, IdKey: b.IdKey, Operations: run.Operations, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
        if (run.Guarded && b.VersionField !== undefined)
        {
            batch.Concurrency = WriteConcurrency.Optimistic;
            batch.VersionField = b.VersionField;
        }
        try
        {
            const result = await this.adapter.Apply(batch, this.context);
            return result.Failures.length === 0
                ? undefined
                : new ExternalWriteError(EngineBridgeErrorCode.CompensationFailed, message, binding, result.Failures);
        }
        catch (error)
        {
            return new ExternalWriteError(EngineBridgeErrorCode.CompensationFailed, message, binding, [], error);
        }
    }

    /**
     * The compensating operations of what applied, in reverse order, cut into runs of one concurrency. An upsert back to a
     * before-image whose committed version the adapter reported is guarded with that version and leaves out the version
     * field (the source moves it on); everything else is last-write-wins. An op with no before-image (a create or an
     * insert) compensates to a Delete of its key.
     */
    private static UndoRuns(attempt: IAttemptedBatch): IUndoRun[]
    {
        const versionField = attempt.Binding.Binding.VersionField;
        const optimistic = attempt.Binding.Binding.Concurrency === WriteConcurrency.Optimistic && versionField !== undefined;
        const runs: IUndoRun[] = [];
        for (const op of [...attempt.Applied].reverse())
        {
            const key = DataSourceTransaction.KeyText(op.Key);
            const row = attempt.Before.get(key);
            const version = attempt.Versions.get(key);
            let undo: WriteOperation;
            let guarded = false;
            if (row !== undefined && optimistic && version !== undefined)
            {
                const fields: Record<string, ExternalFieldValue> = { ...row };
                delete fields[versionField!];
                undo = { Kind: WriteOperationKind.Upsert, Key: op.Key, Fields: fields, Version: version };
                guarded = true;
            }
            else if (row !== undefined)
            {
                undo = { Kind: WriteOperationKind.Upsert, Key: op.Key, Fields: { ...row } };
            }
            else if (op.Kind === WriteOperationKind.Upsert)
            {
                undo = { Kind: WriteOperationKind.Delete, Key: op.Key, Fields: {} };
            }
            else
            {
                continue;
            }
            const last = runs[runs.length - 1];
            if (last !== undefined && last.Guarded === guarded)
            {
                last.Operations.push(undo);
            }
            else
            {
                runs.push({ Guarded: guarded, Operations: [undo] });
            }
        }
        return runs;
    }

    private RequireState(state: TransactionState): void
    {
        if (this.state !== state)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.TransactionClosed, DataSourceTransaction.ErrClosed + this.connector);
        }
    }

    /** A key as text, so a source returning `'7'` for the key 7 still finds its row. */
    private static KeyText(key: ExternalFieldValue): string
    {
        return String(key);
    }

    private static Where(binding: IExternalBinding): string
    {
        return binding.Connector + DataSourceTransaction.SourceSeparator + binding.Binding.Source;
    }
}
