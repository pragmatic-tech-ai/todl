import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { ConnectorSpec, DataSourceKind, ExternalRecord, QueryRequest, ResolvedConnection, WriteBatch, WriteResult } from "./connector-plan.js";

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
