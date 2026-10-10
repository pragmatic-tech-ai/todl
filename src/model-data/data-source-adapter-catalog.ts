import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { ConnectorSpec, DataSourceKind, ResolvedConnection } from "./connector-plan.js";
import {
    ConnectionResolverKey,
    type IConnectionResolver,
    type IDataSourceAdapter,
    type IDataSourceAdapterFactory,
    type IDataSourceAdapterProvider,
} from "./data-source-adapter.js";

/** Plan-1 resolver: uses the spec's inline values as-is. */
export class InlineConnectionResolver implements IConnectionResolver
{
    public async Resolve(spec: ConnectorSpec, _services: IServiceProvider): Promise<ResolvedConnection>
    {
        const connection: ResolvedConnection = { Kind: spec.Kind, Config: spec.Config };
        if (spec.Secret !== undefined) connection.Secret = spec.Secret;
        return connection;
    }
}

/** Opens and memoizes data-source adapters per connector name. */
export class DataSourceAdapterCatalog
{
    public static readonly ServiceKey = new ServiceKey<DataSourceAdapterCatalog>("DataSourceAdapterCatalog");

    private static readonly NoAdapterMessage = "connector '{0}': no data-source adapter available for kind '{1}'";
    private static readonly NamePlaceholder = "{0}";
    private static readonly KindPlaceholder = "{1}";

    private readonly factories = new Map<DataSourceKind, IDataSourceAdapterFactory>();
    private readonly opened = new Map<string, Promise<IDataSourceAdapter>>();
    private readonly inlineResolver = new InlineConnectionResolver();

    public constructor(private readonly provider?: IDataSourceAdapterProvider)
    {
    }

    public Register(factory: IDataSourceAdapterFactory): this
    {
        this.factories.set(factory.Kind, factory);
        return this;
    }

    public Open(spec: ConnectorSpec, services: IServiceProvider): Promise<IDataSourceAdapter>
    {
        let pending = this.opened.get(spec.Name);
        if (!pending)
        {
            pending = this.OpenCore(spec, services);
            this.opened.set(spec.Name, pending);
            pending.catch(() => this.opened.delete(spec.Name));
        }
        return pending;
    }

    private async OpenCore(spec: ConnectorSpec, services: IServiceProvider): Promise<IDataSourceAdapter>
    {
        const factory = await this.ResolveFactory(spec);
        const resolver = services.get(ConnectionResolverKey) ?? this.inlineResolver;
        const connection = await resolver.Resolve(spec, services);
        return factory.Open(connection);
    }

    private async ResolveFactory(spec: ConnectorSpec): Promise<IDataSourceAdapterFactory>
    {
        const registered = this.factories.get(spec.Kind);
        if (registered) return registered;
        if (this.provider)
        {
            try
            {
                return await this.provider.Resolve(spec.Kind);
            }
            catch
            {
                // fall through to the connector diagnostic below
            }
        }
        throw new Error(DataSourceAdapterCatalog.NoAdapterMessage
            .replace(DataSourceAdapterCatalog.NamePlaceholder, spec.Name)
            .replace(DataSourceAdapterCatalog.KindPlaceholder, spec.Kind));
    }
}
