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
