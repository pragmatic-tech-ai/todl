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
import { ReconnectingAdapter } from "./reconnecting-adapter.js";
import { ReconnectObserverKey } from "./connection-reconnect.js";
import type { ConnectionRetryPolicy } from "./connection-reconnect.js";

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
    private static readonly NoProviderMessage = "connector '{0}': names provider '{1}' but no adapter provider is configured";
    private static readonly PlaceholderPattern = /\{(\d)\}/g;
    private static readonly DefaultRetryPolicy: ConnectionRetryPolicy =
        { InitialDelayMs: 200, Factor: 2, MaxDelayMs: 2000, MaxAttempts: 3 };

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
        // Memoize per connector DECLARATION: the namespace-qualified id when present
        // (so e.g. shop.pg and inventory.pg stay distinct), falling back to the bare
        // Name for hand-written specs that carry no Id.
        const key = this.KeyFor(spec);
        let pending = this.opened.get(key);
        if (!pending)
        {
            pending = this.OpenReconnecting(spec, services);
            this.opened.set(key, pending);
            pending.catch(() =>
            {
                if (this.opened.get(key) === pending) this.opened.delete(key);
            });
        }
        return pending;
    }

    private async OpenReconnecting(spec: ConnectorSpec, services: IServiceProvider): Promise<IDataSourceAdapter>
    {
        const inner = await this.OpenCore(spec, services);
        const observer = services.get(ReconnectObserverKey);
        return new ReconnectingAdapter(
            spec.Name,
            inner,
            () => this.OpenCore(spec, services),
            DataSourceAdapterCatalog.DefaultRetryPolicy,
            observer,
        );
    }

    /** Disposes and drops the memoized adapter for one connector so the next Open re-resolves and re-opens
     *  it (fresh credentials + pool). Idempotent; a failed open or a Dispose throw is swallowed. */
    public async Invalidate(spec: ConnectorSpec): Promise<void>
    {
        const key = this.KeyFor(spec);
        const pending = this.opened.get(key);
        if (!pending) return;
        this.opened.delete(key);
        try
        {
            const adapter = await pending;
            await adapter.Dispose();
        }
        catch
        {
            // A failed open produced no adapter, or Dispose threw; the entry is already dropped.
        }
    }

    private KeyFor(spec: ConnectorSpec): string
    {
        return spec.Id ?? spec.Name;
    }

    /** Disposes every memoized adapter and clears the cache. Idempotent; per-adapter failures are swallowed. */
    public async Dispose(): Promise<void>
    {
        const pending = [...this.opened.values()];
        this.opened.clear();
        await Promise.all(pending.map(async (opening) => {
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
        if (spec.Provider !== undefined)
        {
            return this.ResolveNamedProvider(spec, spec.Provider);
        }
        const registered = this.factories.get(spec.Kind);
        if (registered) return registered;
        let cause: unknown;
        if (this.provider)
        {
            try
            {
                return await this.provider.Resolve({ Kind: spec.Kind });
            }
            catch (error)
            {
                cause = error;
            }
        }
        const message = DataSourceAdapterCatalog.Format(DataSourceAdapterCatalog.NoAdapterMessage, [spec.Name, spec.Kind]);
        throw cause === undefined ? new Error(message) : new Error(message, { cause });
    }

    // A connector that NAMES a provider pack resolves through the injected provider - the pack is
    // authoritative. A missing provider or a provider rejection is fail-closed: never silently fall
    // back to a Kind-registered factory, which would mask a provisioning failure.
    private async ResolveNamedProvider(spec: ConnectorSpec, provider: string): Promise<IDataSourceAdapterFactory>
    {
        if (this.provider === undefined)
        {
            throw new Error(DataSourceAdapterCatalog.Format(DataSourceAdapterCatalog.NoProviderMessage, [spec.Name, provider]));
        }
        return this.provider.Resolve({ Kind: spec.Kind, Provider: provider });
    }

    private static Format(template: string, args: readonly string[]): string
    {
        return template.replace(
            DataSourceAdapterCatalog.PlaceholderPattern, (_match, index: string) => args[Number(index)] ?? "");
    }
}
