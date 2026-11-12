import { QueryFilterEvaluator } from "../query-filter-evaluator.js";
import { QueryCompareOp, WriteConcurrency, WriteFailureKind, WriteOperationKind } from "../connector-plan.js";
import type { DataSourceKind, ExternalFieldValue, ExternalRecord, IAssignedKey, QueryRequest, ResolvedConnection, WriteBatch, WriteFailure, WriteOperation, WriteResult } from "../connector-plan.js";
import type { AdapterResolutionRequest, IAdapterWriteCapabilities, IDataSourceAdapter, IDataSourceAdapterFactory, IDataSourceAdapterProvider } from "../data-source-adapter.js";

export class InMemoryAdapter implements IDataSourceAdapter
{
    private static readonly StaleVersionMessage = "stale version on";

    private readonly sources = new Map<string, ExternalRecord[]>();

    public Seed(source: string, records: ExternalRecord[]): this
    {
        this.sources.set(source, [...records]);
        return this;
    }

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        // The shared SQL-null semantics every re-filtering adapter uses.
        const rows = (this.sources.get(request.Source) ?? []).filter(row => QueryFilterEvaluator.Matches(row, request.Where));
        return rows.map(row =>
        {
            const projected: { [field: string]: ExternalRecord[string] } = {};
            for (const field of request.Fields)
            {
                if (field in row) projected[field] = row[field] ?? null;
            }
            return projected;
        });
    }

    // Mirrors SqlAdapter: in Optimistic mode (with a VersionField) an upsert of an existing row and every delete are
    // version-guarded (ruling R122 G1); a guarded delete of a missing row, or of a row at another version, is a Conflict.
    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        const rows = this.sources.get(batch.Source) ?? [];
        this.sources.set(batch.Source, rows);
        const failures: WriteFailure[] = [];
        const assigned: IAssignedKey[] = [];
        let applied = 0;
        for (const op of batch.Operations)
        {
            if (op.Kind === WriteOperationKind.Insert)
            {
                const key = InMemoryAdapter.NextKey(rows, batch.IdKey);
                const row: { [field: string]: ExternalRecord[string] } = { ...op.Fields, [batch.IdKey]: key };
                if (batch.VersionField !== undefined && row[batch.VersionField] === undefined)
                {
                    row[batch.VersionField] = 1;
                }
                rows.push(row);
                applied++;
                assigned.push(batch.VersionField === undefined
                    ? { Ref: op.Ref!, Key: key }
                    : { Ref: op.Ref!, Key: key, Version: row[batch.VersionField] ?? null });
                continue;
            }
            const index = rows.findIndex(row => row[batch.IdKey] === op.Key);
            if (op.Kind === WriteOperationKind.Delete)
            {
                if (batch.Concurrency === WriteConcurrency.Optimistic && batch.VersionField !== undefined
                    && (index < 0 || !InMemoryAdapter.VersionMatches(rows[index]!, batch.VersionField, op.Version)))
                {
                    failures.push({ Key: op.Key, Kind: WriteFailureKind.Conflict, Reason: `${InMemoryAdapter.StaleVersionMessage} ${batch.VersionField}` });
                    continue;
                }
                if (index >= 0)
                {
                    rows.splice(index, 1);
                    applied++;
                }
                continue;
            }
            // Mirror SqlAdapter: the version guard fires ONLY in Optimistic mode (with a VersionField);
            // LastWriteWins is an unconditional upsert regardless of any VersionField on the batch.
            if (batch.Concurrency === WriteConcurrency.Optimistic && batch.VersionField !== undefined && index >= 0)
            {
                // Fail-closed like SqlAdapter's "version = ?" guard: a NULL stored version never matches
                // (NULL = NULL is UNKNOWN), so a present-but-unversioned row is a Conflict even when
                // op.Version is also null. Only a non-null stored version equal to op.Version writes.
                if (!InMemoryAdapter.VersionMatches(rows[index]!, batch.VersionField, op.Version))
                {
                    failures.push({ Key: op.Key, Kind: WriteFailureKind.Conflict, Reason: `${InMemoryAdapter.StaleVersionMessage} ${batch.VersionField}` });
                    continue;
                }
            }
            const row: { [field: string]: ExternalRecord[string] } = { ...op.Fields, [batch.IdKey]: op.Key };
            if (index >= 0) rows[index] = row;
            else rows.push(row);
            applied++;
        }
        return assigned.length === 0 ? { Applied: applied, Failures: failures } : { Applied: applied, Failures: failures, Assigned: assigned };
    }

    public async Dispose(): Promise<void>
    {
    }

    /** This fake assigns source keys for Insert ops (serials). */
    public get CanAssignKeys(): boolean
    {
        return true;
    }

    /** The next serial key for `source`: one past the largest numeric IdKey it holds (1 when empty). */
    private static NextKey(rows: readonly ExternalRecord[], idKey: string): ExternalFieldValue
    {
        let max = 0;
        for (const row of rows)
        {
            const value = Number(row[idKey]);
            if (Number.isFinite(value) && value > max)
            {
                max = value;
            }
        }
        return max + 1;
    }

    /** True when `row` holds a non-null version equal to `version` (SQL's `version = $n`: NULL never matches). */
    private static VersionMatches(row: ExternalRecord, versionField: string, version: WriteOperation["Version"]): boolean
    {
        const stored = row[versionField] ?? null;
        return stored !== null && stored === (version ?? null);
    }
}

export class InMemoryAdapterFactory implements IDataSourceAdapterFactory
{
    public readonly Adapter = new InMemoryAdapter();
    /** Mirrors the opened InMemoryAdapter: assigns source keys, no transactions or versioning. */
    public readonly WriteCapabilities: IAdapterWriteCapabilities = Object.freeze({ CanAssignKeys: true });

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        return this.Adapter;
    }
}

export class CountingAdapterFactory implements IDataSourceAdapterFactory
{
    private static readonly FailureMessage = "simulated query failure";

    public QueryCount = 0;
    /** Mirrors the opened adapter, which declares no write capability. */
    public readonly WriteCapabilities: IAdapterWriteCapabilities = Object.freeze({});

    private failNext = false;

    private readonly inner = new InMemoryAdapter();
    private readonly adapter: IDataSourceAdapter =
    {
        Query: async (request: QueryRequest) =>
        {
            this.QueryCount++;
            if (this.failNext)
            {
                this.failNext = false;
                throw new Error(CountingAdapterFactory.FailureMessage);
            }
            return this.inner.Query(request);
        },
        Apply: async (batch: WriteBatch) => this.inner.Apply(batch),
        Dispose: async () => this.inner.Dispose(),
    };

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    /** Makes the next Query throw once. */
    public FailNext(): this
    {
        this.failNext = true;
        return this;
    }

    public Seed(source: string, records: ExternalRecord[]): this
    {
        this.inner.Seed(source, records);
        return this;
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        return this.adapter;
    }
}

export class RegisteredAdapterProvider implements IDataSourceAdapterProvider
{
    private static readonly MissingMessage = "no factory registered for kind";

    private readonly factories = new Map<DataSourceKind, IDataSourceAdapterFactory>();

    public Add(factory: IDataSourceAdapterFactory): this
    {
        this.factories.set(factory.Kind, factory);
        return this;
    }

    public async Resolve(request: AdapterResolutionRequest): Promise<IDataSourceAdapterFactory>
    {
        const factory = this.factories.get(request.Kind);
        if (!factory) throw new Error(`${RegisteredAdapterProvider.MissingMessage} ${request.Kind}`);
        return factory;
    }
}
