import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { ConnectorSpec, DataSourceKind, ExternalRecord, QueryRequest, ResolvedConnection, WriteBatch, WriteResult } from "./connector-plan.js";

/** A live connection to one external data source. */
export interface IDataSourceAdapter
{
    Query(request: QueryRequest): Promise<readonly ExternalRecord[]>;
    Apply(batch: WriteBatch): Promise<WriteResult>;
}

/** Opens adapters for one kind of data source. */
export interface IDataSourceAdapterFactory
{
    readonly Kind: DataSourceKind;
    Open(connection: ResolvedConnection): Promise<IDataSourceAdapter>;
}

/** Supplies a factory for a kind on demand (e.g. lazily loaded adapter packs). */
export interface IDataSourceAdapterProvider
{
    Resolve(kind: DataSourceKind): Promise<IDataSourceAdapterFactory>;
}

/** Turns a connector spec into concrete connection details. */
export interface IConnectionResolver
{
    Resolve(spec: ConnectorSpec, services: IServiceProvider): Promise<ResolvedConnection>;
}

export const ConnectionResolverKey = new ServiceKey<IConnectionResolver>("DataSourceConnectionResolver");
