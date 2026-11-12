import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { ConnectorSpec, DataSourceKind, ExternalFieldValue, ExternalRecord, QueryRequest, ResolvedConnection, WriteBatch, WriteResult } from "./connector-plan.js";
import type { ConnectionFailureKind } from "./connection-reconnect.js";

/** A keyset page request: rows strictly after `After` (by the order key), at most `Limit`. */
export interface PageQuery
{
    After?: ExternalFieldValue;
    Limit: number;
}

/** One keyset page; `NextAfter` is set only when a full page came back (more may exist). */
export interface PageSlice
{
    Records: readonly ExternalRecord[];
    NextAfter?: ExternalFieldValue;
}

/**
 * On whose behalf a data-source call runs: the engine's opaque ConnectorContext, forwarded as-is (spec §6, PR12).
 * Structural, so model-data never imports the engine; TODL forwards it and never interprets it.
 */
export interface IDataSourceContext
{
    /** Opaque key; '' is the anonymous context. Adapters with dedicated credentials ignore it. */
    readonly Key: string;
}

/**
 * A live connection to one external data source. Every call takes an optional trailing `context`: the engine-driven
 * paths (DataSourceConnector, DataSourceTransaction) pass the caller's; the federated, prefetch and working-copy paths
 * have no caller and pass none. An adapter that does not act as the caller ignores it. An absent context (undefined)
 * means the anonymous context, the same as Key ''.
 */
export interface IDataSourceAdapter
{
    Query(request: QueryRequest, context?: IDataSourceContext): Promise<readonly ExternalRecord[]>;
    Apply(batch: WriteBatch, context?: IDataSourceContext): Promise<WriteResult>;
    /** Releases any driver connection/pool held by this adapter. Idempotent. */
    Dispose(): Promise<void>;
    /** Whether this adapter can run a batch inside a backend transaction. Optional so existing
     *  fakes and the merged adapter-pack ABI keep compiling; absent -> the weakest guarantee (false). */
    readonly CanTransact?: boolean;
    /** Whether this adapter can enforce an optimistic version guard. Optional for the same reason;
     *  absent -> false. */
    readonly CanVersion?: boolean;
    /** Classifies a thrown driver error so the reconnecting catalog can retry/reopen. Optional so existing
     *  fakes and the adapter-pack ABI keep compiling; absent -> every error is treated as Permanent. */
    ClassifyFailure?(error: unknown): ConnectionFailureKind;
    /** True when the SOURCE assigns versions itself (HTTP etag / If-Match, a GraphQL server with a version argument): the
     *  engine then never computes a next version for it. Optional; absent -> false (the source stores what is written). */
    readonly SourceManagesVersions?: boolean;
    /** Whether this adapter can serve keyset-paged reads (QueryPage). Optional; absent -> false. */
    readonly CanPage?: boolean;
    /** True when this adapter can execute source-keyed inserts (WriteOperationKind.Insert) and report the assigned keys
     *  in WriteResult.Assigned. Optional; absent -> false (the adapter cannot take `keys source` creates). */
    readonly CanAssignKeys?: boolean;
    /** Keyset page: rows with OrderKey > page.After, sorted by OrderKey asc, at most page.Limit. Optional. */
    QueryPage?(request: QueryRequest, page: PageQuery, context?: IDataSourceContext): Promise<PageSlice>;
}

/** Opens adapters for one kind of data source. */
export interface IDataSourceAdapterFactory
{
    readonly Kind: DataSourceKind;
    Open(connection: ResolvedConnection): Promise<IDataSourceAdapter>;
}

/** The information a provider needs to resolve a factory: the data-source Kind and, when the
 *  connector named one, the provider pack specifier (name@range). Never carries the spec or its
 *  secrets. */
export interface AdapterResolutionRequest
{
    readonly Kind: DataSourceKind;
    readonly Provider?: string;
}

/** Supplies a factory for a resolution request on demand (e.g. lazily loaded adapter packs). */
export interface IDataSourceAdapterProvider
{
    Resolve(request: AdapterResolutionRequest): Promise<IDataSourceAdapterFactory>;
}


/** Turns a connector spec into concrete connection details. */
export interface IConnectionResolver
{
    Resolve(spec: ConnectorSpec, services: IServiceProvider): Promise<ResolvedConnection>;
}

export const ConnectionResolverKey = new ServiceKey<IConnectionResolver>("DataSourceConnectionResolver");
