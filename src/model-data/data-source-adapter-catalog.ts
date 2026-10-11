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
    private static readonly PlaceholderPattern = /\{(\d)\}/g;

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

    /** Disposes every memoized adapter and clears the cache. Idempotent; per-adapter failures are swallowed. */
    public async Dispose(): Promise<void>
    {
        const pending = [...this.opened.values()];
        this.opened.clear();
        await Promise.all(pending.map(async (opening) =>
        {
            try
            {
                const adapter = await opening;
                await adapter.Dispose();
            }
            catch
            {
                // A failed Open produced no adapter, or an adapter's Dispose threw; neither should
                // prevent the remaining adapters from being disposed.
            }
        }));
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
        let cause: unknown;
        if (this.provider)
        {
            try
            {
                return await this.provider.Resolve(spec.Kind);
            }
            catch (error)
            {
                cause = error;
            }
        }
        const args: string[] = [spec.Name, spec.Kind];
        const message = DataSourceAdapterCatalog.NoAdapterMessage.replace(
            DataSourceAdapterCatalog.PlaceholderPattern, (_match, index: string) => args[Number(index)] ?? "");
        throw cause === undefined ? new Error(message) : new Error(message, { cause });
    }
}
