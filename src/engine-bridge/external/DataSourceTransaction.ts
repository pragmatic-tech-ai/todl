import { ConnectorChangeSet, type ConnectorChange, type IConnectorTransaction } from '@pragmatic-tech-ai/graph';
import {
    QueryCompareOp,
    WriteAtomicity,
    WriteConcurrency,
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
}

/**
 * One engine transaction's writes to one DataSourceConnector (ruling T9).
 *
 * Apply only translates and validates (ChangeBatcher), with no remote effect, and refuses a Transactional binding whose
 * adapter cannot transact (UnsupportedExternalChange). Changes of several Apply calls merge as one change set.
 *
 * Commit writes the batches in order. For each it first reads a before-image (Query with IdKey in the batch keys, over
 * IdKey, every FieldMap field and the version field), sets each operation's Version from it for an Optimistic binding
 * (owner question Q1: this guards the commit window only), then calls adapter.Apply. Per-operation failures throw
 * ExternalWriteError (ExternalWriteFailed) and stop the commit. A thrown adapter error propagates as it is.
 *
 * Revert before Commit discards. After Commit, or after a Commit that stopped partway, it compensates every operation
 * that applied, in reverse order: a key without a before-image is deleted, every other key is upserted back to its
 * before-image, last-write-wins, one sequential batch per committed batch. An operation the source reported as failed
 * did not apply; when the adapter call threw, every operation of that batch counts as applied (compensating one that
 * did not is harmless). A batch of a Transactional binding over a transacting adapter that failed applied nothing.
 * A failed compensation throws ExternalWriteError (CompensationFailed) after every batch was tried. Before-images live
 * only as long as the transaction (spec §5.2, §12).
 */
export class DataSourceTransaction implements IConnectorTransaction
{
    private static readonly ErrClosed = 'The external transaction no longer takes this call: ';
    private static readonly ErrNoTransact = 'A transactional binding needs an adapter that can transact: ';
    private static readonly ErrWrite = 'External write failed on ';
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
        const batch = DataSourceTransaction.Guarded(binding, pending.Batch, before);
        const transacted = binding.Binding.Atomicity === WriteAtomicity.Transactional && this.adapter.CanTransact === true;
        const attempt: IAttemptedBatch = { Binding: binding, Before: before, Applied: batch.Operations };
        this.attempted.push(attempt);
        let failures: readonly WriteFailure[];
        try
        {
            failures = (await this.adapter.Apply(batch)).Failures;
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
            throw new ExternalWriteError(
                EngineBridgeErrorCode.ExternalWriteFailed,
                DataSourceTransaction.ErrWrite + DataSourceTransaction.Where(binding) + DataSourceTransaction.CountOpen + failures.length + DataSourceTransaction.CountClose,
                binding,
                failures);
        }
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
            const operations = DataSourceTransaction.Undo(attempt);
            if (operations.length === 0)
            {
                continue;
            }
            const failure = await this.Undo(attempt.Binding, operations);
            first ??= failure;
        }
        this.attempted.length = 0;
        if (first !== undefined)
        {
            throw first;
        }
    }

    /** Applies the compensating operations of one batch; the error describing a failure, else undefined. */
    private async Undo(binding: IExternalBinding, operations: readonly WriteOperation[]): Promise<ExternalWriteError | undefined>
    {
        const b = binding.Binding;
        const message = DataSourceTransaction.ErrCompensate + DataSourceTransaction.Where(binding);
        try
        {
            const result = await this.adapter.Apply({
                Source: b.Source, IdKey: b.IdKey, Operations: operations, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            });
            return result.Failures.length === 0
                ? undefined
                : new ExternalWriteError(EngineBridgeErrorCode.CompensationFailed, message, binding, result.Failures);
        }
        catch (error)
        {
            return new ExternalWriteError(EngineBridgeErrorCode.CompensationFailed, message, binding, [], error);
        }
    }

    /** The compensating operations of what applied, in reverse order. */
    private static Undo(attempt: IAttemptedBatch): WriteOperation[]
    {
        const undo: WriteOperation[] = [];
        for (const op of [...attempt.Applied].reverse())
        {
            const row = attempt.Before.get(DataSourceTransaction.KeyText(op.Key));
            if (row !== undefined)
            {
                undo.push({ Kind: WriteOperationKind.Upsert, Key: op.Key, Fields: { ...row } });
            }
            else if (op.Kind === WriteOperationKind.Upsert)
            {
                undo.push({ Kind: WriteOperationKind.Delete, Key: op.Key, Fields: {} });
            }
        }
        return undo;
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
