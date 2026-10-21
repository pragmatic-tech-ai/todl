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

/** A live connection to one external data source. */
export interface IDataSourceAdapter
{
    Query(request: QueryRequest): Promise<readonly ExternalRecord[]>;
    Apply(batch: WriteBatch): Promise<WriteResult>;
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
    /** Whether this adapter can serve keyset-paged reads (QueryPage). Optional; absent -> false. */
    readonly CanPage?: boolean;
    /** Keyset page: rows with OrderKey > page.After, sorted by OrderKey asc, at most page.Limit. Optional. */
    QueryPage?(request: QueryRequest, page: PageQuery): Promise<PageSlice>;
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
