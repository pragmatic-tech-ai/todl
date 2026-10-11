import { QueryCompareOp, WriteOperationKind } from "../connector-plan.js";
import type { DataSourceKind, ExternalRecord, QueryRequest, ResolvedConnection, WriteBatch, WriteConflict, WriteResult } from "../connector-plan.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory, IDataSourceAdapterProvider } from "../data-source-adapter.js";

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
        const comparisons = request.Where?.All ?? [];
        const rows = (this.sources.get(request.Source) ?? []).filter(row => comparisons.every(c =>
        {
            const fieldValue = row[c.Field];
            // NULL operand -> SQL UNKNOWN for both = and <> -> row excluded.
            if (fieldValue === null || fieldValue === undefined || c.Value === null) return false;
            return c.Op === QueryCompareOp.Neq ? fieldValue !== c.Value : fieldValue === c.Value;
        }));
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

    // Delete is UNCONDITIONAL in v1: the optimistic version guard applies to Upsert only (a delete-guard is a follow-on).
    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        const rows = this.sources.get(batch.Source) ?? [];
        this.sources.set(batch.Source, rows);
        const conflicts: WriteConflict[] = [];
        let applied = 0;
        for (const op of batch.Operations)
        {
            const index = rows.findIndex(row => row[batch.IdKey] === op.Key);
            if (op.Kind === WriteOperationKind.Delete)
            {
                if (index >= 0)
                {
                    rows.splice(index, 1);
                    applied++;
                }
                continue;
            }
            if (batch.VersionField !== undefined && index >= 0)
            {
                const stored = rows[index]![batch.VersionField] ?? null;
                if (stored !== (op.Version ?? null))
                {
                    conflicts.push({ Key: op.Key, Reason: `${InMemoryAdapter.StaleVersionMessage} ${batch.VersionField}` });
                    continue;
                }
            }
            const row: { [field: string]: ExternalRecord[string] } = { ...op.Fields, [batch.IdKey]: op.Key };
            if (index >= 0) rows[index] = row;
            else rows.push(row);
            applied++;
        }
        return { Applied: applied, Conflicts: conflicts };
    }

    public async Dispose(): Promise<void>
    {
    }
}

export class InMemoryAdapterFactory implements IDataSourceAdapterFactory
{
    public readonly Adapter = new InMemoryAdapter();

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

    public async Resolve(kind: DataSourceKind): Promise<IDataSourceAdapterFactory>
    {
        const factory = this.factories.get(kind);
        if (!factory) throw new Error(`${RegisteredAdapterProvider.MissingMessage} ${kind}`);
        return factory;
    }
}
