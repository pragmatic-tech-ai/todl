import { ConnectorChangeSet, type ConnectorChange, type IConnectorTransaction } from '@pragmatic-tech-ai/graph';
import {
    QueryCompareOp,
    WriteAtomicity,
    WriteConcurrency,
    WriteFailureKind,
    WriteOperationKind,
    type ExternalFieldValue,
    type ExternalRecord,
    type WriteBatch,
    type WriteFailure,
    type WriteOperation,
} from '../../model-data/connector-plan.js';
import type { IDataSourceAdapter } from '../../model-data/data-source-adapter.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { ChangeBatcher, type IPendingBatch } from './ChangeBatcher.js';
import type { IExternalBinding } from './ExternalBinding.js';
import type { ExternalIdentity } from './ExternalIdentity.js';
import { ExternalWriteError } from './ExternalWriteError.js';

/** Consecutive compensating operations of one concurrency, sent as one sequential batch. */
interface IUndoRun
{
    readonly Guarded: boolean;
    readonly Operations: WriteOperation[];
}

/** Where a DataSourceTransaction is in its life. */
enum TransactionState
{
    Open = 1,
    /** Commit started; it may have stopped partway (a batch failed). */
    Committing,
    Committed,
    Reverted,
}

/** A batch Commit sent to the source: its before-image and the operations that (may have) applied. */
interface IAttemptedBatch
{
    readonly Binding: IExternalBinding;
    /** Before-image rows by key text; a key without one did not exist before the write. */
    readonly Before: ReadonlyMap<string, ExternalRecord>;
    Applied: readonly WriteOperation[];
    /** The version each applied upsert carries after the write, by key text, when the adapter reported it. */
    Versions: ReadonlyMap<string, ExternalFieldValue>;
}

/**
 * One engine transaction's writes to one DataSourceConnector (ruling T9).
 *
 * Apply only translates and validates (ChangeBatcher), with no remote effect, and refuses a Transactional binding whose
 * adapter cannot transact (UnsupportedExternalChange). Changes of several Apply calls merge as one change set.
 *
 * Commit writes the batches in order. For each it first reads a before-image (Query with IdKey in the batch keys, over
 * IdKey, every FieldMap field and the version field). A create of a new row (ChangeBatcher's Creates) whose key the
 * before-image holds is a conflict: the batch is not written and Commit throws ExternalWriteError (ExternalWriteFailed)
 * with a Conflict failure per such key, so a create never silently updates a row the before-image saw. The check covers
 * the before-image only: a row another writer inserts between that read and adapter.Apply is still upserted (the same
 * commit-window limit as Q1). Otherwise it sets each operation's Version from the before-image for an Optimistic
 * binding (owner question Q1: this guards the commit window only), then calls adapter.Apply. Per-operation failures
 * throw ExternalWriteError (ExternalWriteFailed) and stop the commit. An error raised by the transaction itself
 * (e.g., a constraint checked only at COMMIT, a serialization failure, a lost connection) and the adapters'
 * identifier guards propagate as the adapter's error (the engine reports them as ConnectorError).
 *
 * Revert before Commit discards. After Commit, or after a Commit that stopped partway, it compensates every operation
 * that applied, in reverse order: a key without a before-image is deleted, every other key is upserted back to its
 * before-image, last-write-wins, one sequential batch per committed batch. An operation the source reported as failed
 * did not apply; when the adapter call threw, every operation of that batch counts as applied (compensating one that
 * did not is harmless). A batch of a Transactional binding over a transacting adapter that failed applied nothing.
 * A failed compensation throws ExternalWriteError (CompensationFailed) after every batch was tried. Before-images live
 * only as long as the transaction (spec §5.2, §12).
 *
 * Optimistic bindings: compensation is best effort. When the adapter reported the version a committed upsert left
 * (WriteResult.Versions, e.g. VersionBumpingAdapter), the compensating upsert is guarded with that version and leaves
 * the version field to the source, so the version moves forward rather than back to the before-image (no ABA), and a
 * concurrent change since the commit makes the compensation fail (CompensationFailed) instead of being overwritten.
 * Without a reported version (a source that reports none, an explicitly written version member, an adapter call that
 * threw) the before-image is restored last-write-wins, version field included.
 */
export class DataSourceTransaction implements IConnectorTransaction
{
    private static readonly ErrClosed = 'The external transaction no longer takes this call: ';
    private static readonly ErrNoTransact = 'A transactional binding needs an adapter that can transact: ';
    private static readonly ErrWrite = 'External write failed on ';
    private static readonly ErrExists = 'A created external row already exists in the source';
    private static readonly ErrCompensate = 'Compensating an external write failed on ';
    private static readonly SourceSeparator = '.';
    private static readonly CountOpen = ' (';
    private static readonly CountClose = ' failed)';

    private state = TransactionState.Open;
    private readonly changes: ConnectorChange[] = [];
    private pending: readonly IPendingBatch[] = [];
    private readonly attempted: IAttemptedBatch[] = [];

    public constructor(
        private readonly connector: string,
        private readonly adapter: IDataSourceAdapter,
        private readonly identity: ExternalIdentity,
    )
    {
    }

    public async Apply(changes: ConnectorChangeSet): Promise<void>
    {
        this.RequireState(TransactionState.Open);
        // The engine calls Apply once per transaction. A further call re-merges the whole accumulated list, so the ops on
        // one id still merge into one operation across calls.
        const all = [...this.changes, ...changes.Changes];
        const pending = ChangeBatcher.Batches(new ConnectorChangeSet(all), this.identity, this.connector);
        for (const batch of pending)
        {
            if (batch.Binding.Binding.Atomicity === WriteAtomicity.Transactional && this.adapter.CanTransact !== true)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, DataSourceTransaction.ErrNoTransact + DataSourceTransaction.Where(batch.Binding));
            }
        }
        this.changes.push(...changes.Changes);
        this.pending = pending;
    }

    public async Commit(): Promise<void>
    {
        this.RequireState(TransactionState.Open);
        this.state = TransactionState.Committing;
        for (const pending of this.pending)
        {
            await this.Write(pending);
        }
        this.state = TransactionState.Committed;
    }

    public async Revert(): Promise<void>
    {
        const state = this.state;
        this.state = TransactionState.Reverted;
        if (state === TransactionState.Committing || state === TransactionState.Committed)
        {
            await this.Compensate();
        }
    }

    private async Write(pending: IPendingBatch): Promise<void>
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
        const batch = DataSourceTransaction.Guarded(binding, pending.Batch, before);
        const transacted = binding.Binding.Atomicity === WriteAtomicity.Transactional && this.adapter.CanTransact === true;
        const attempt: IAttemptedBatch = { Binding: binding, Before: before, Applied: batch.Operations, Versions: new Map() };
        this.attempted.push(attempt);
        let failures: readonly WriteFailure[];
        try
        {
            const result = await this.adapter.Apply(batch);
            failures = result.Failures;
            attempt.Versions = new Map((result.Versions ?? []).map(v => [DataSourceTransaction.KeyText(v.Key), v.Version]));
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
            throw DataSourceTransaction.WriteFailed(binding, failures);
        }
    }

    private static WriteFailed(binding: IExternalBinding, failures: readonly WriteFailure[]): ExternalWriteError
    {
        return new ExternalWriteError(
            EngineBridgeErrorCode.ExternalWriteFailed,
            DataSourceTransaction.ErrWrite + DataSourceTransaction.Where(binding) + DataSourceTransaction.CountOpen + failures.length + DataSourceTransaction.CountClose,
            binding,
            failures);
    }

    /** The current rows of the batch's keys, over IdKey, every FieldMap field and the version field. */
    private async BeforeImage(binding: IExternalBinding, batch: WriteBatch): Promise<ReadonlyMap<string, ExternalRecord>>
    {
        const b = binding.Binding;
        const fields = new Set<string>([b.IdKey, ...Object.values(b.FieldMap)]);
        if (b.VersionField !== undefined)
        {
            fields.add(b.VersionField);
        }
        const keys = batch.Operations.map(o => o.Key);
        const rows = await this.adapter.Query({
            Source: b.Source,
            Fields: [...fields],
            Where: { All: [{ Field: b.IdKey, Op: QueryCompareOp.In, Value: null, Values: keys }] },
        });
        const before = new Map<string, ExternalRecord>();
        for (const row of rows)
        {
            before.set(DataSourceTransaction.KeyText(row[b.IdKey] ?? null), row);
        }
        return before;
    }

    /** The batch with each operation's Version taken from its before-image, for an Optimistic binding with a version field. */
    private static Guarded(binding: IExternalBinding, batch: WriteBatch, before: ReadonlyMap<string, ExternalRecord>): WriteBatch
    {
        const versionField = binding.Binding.VersionField;
        if (binding.Binding.Concurrency !== WriteConcurrency.Optimistic || versionField === undefined)
        {
            return batch;
        }
        const operations = batch.Operations.map(o =>
        {
            const row = before.get(DataSourceTransaction.KeyText(o.Key));
            return row === undefined ? o : { ...o, Version: row[versionField] ?? null };
        });
        return { ...batch, Operations: operations };
    }

    private async Compensate(): Promise<void>
    {
        let first: ExternalWriteError | undefined;
        for (const attempt of [...this.attempted].reverse())
        {
            for (const run of DataSourceTransaction.Undo(attempt))
            {
                const failure = await this.Undo(attempt.Binding, run);
                first ??= failure;
            }
        }
        this.attempted.length = 0;
        if (first !== undefined)
        {
            throw first;
        }
    }

    /** Applies one run of compensating operations; the error describing a failure, else undefined. */
    private async Undo(binding: IExternalBinding, run: IUndoRun): Promise<ExternalWriteError | undefined>
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
            const result = await this.adapter.Apply(batch);
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
     * field (the source moves it on); everything else is last-write-wins.
     */
    private static Undo(attempt: IAttemptedBatch): IUndoRun[]
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
