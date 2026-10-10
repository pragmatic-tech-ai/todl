import type { DataSourceKind, ExternalRecord, QueryRequest, ResolvedConnection } from "../connector-plan.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory, IDataSourceAdapterProvider } from "../data-source-adapter.js";

export class InMemoryAdapter implements IDataSourceAdapter
{
    private readonly sources = new Map<string, ExternalRecord[]>();

    public Seed(source: string, records: ExternalRecord[]): this
    {
        this.sources.set(source, records);
        return this;
    }

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        const rows = this.sources.get(request.Source) ?? [];
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
