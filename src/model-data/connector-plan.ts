import type { Scalar } from "../compiler-services/model/graph.js";

/** The kind of external datasource a connector talks to. */
export enum DataSourceKind
{
    Sql = "sql",
    Rest = "rest",
    Cypher = "cypher",
    Document = "document",
}

/** A named connector declared by a model. */
export interface ConnectorSpec
{
    Name: string;
    Kind: DataSourceKind;
    Connection?: string;
    Config: Record<string, string>;
    Secret?: string;
}

/** Binds a concept to a source (table, endpoint, ...) on a connector. */
export interface ConnectorBinding
{
    Concept: string;
    Connector: string;
    Source: string;
    IdKey: string;
    FieldMap: Record<string, string>;
    Writable: boolean;
    /** External version/etag column guarding optimistic writes; absent = last-write-wins. */
    VersionField?: string;
}

/** The datasource + bound source (table/endpoint) a connector-minted instance node came from. */
export interface SourceRef
{
    readonly Connector: string;
    readonly Source: string;
}

/** The complete connector plan emitted for a model. */
export interface ModelConnectorPlan
{
    Model: string;
    Version: string;
    Connectors: ConnectorSpec[];
    Bindings: ConnectorBinding[];
}

export type ExternalFieldValue = Scalar | null;

/** One record read from an external source, keyed by external field name. */
export interface ExternalRecord
{
    readonly [field: string]: ExternalFieldValue;
}

/** Comparison operator of a push-down filter term. */
export enum QueryCompareOp
{
    Eq = "eq",
    Neq = "neq",
}

/** One field comparison in a push-down filter. */
export interface QueryComparison
{
    Field: string;
    Op: QueryCompareOp;
    Value: ExternalFieldValue;
}

/** A conjunction of comparisons (the push-down-eligible subset of a filter). */
export interface QueryFilter
{
    All: readonly QueryComparison[];
}

/** A read request against a source. */
export interface QueryRequest
{
    Source: string;
    Fields: readonly string[];
    Where?: QueryFilter;
}

/** The kind of write an adapter applies to one record. */
export enum WriteOperationKind
{
    Upsert = "upsert",
    Delete = "delete",
}

/** One record write; Fields are already in EXTERNAL field names. */
export interface WriteOperation
{
    Kind: WriteOperationKind;
    Key: ExternalFieldValue;
    Fields: Record<string, ExternalFieldValue>;
    /** Expected prior version (optimistic mode). */
    Version?: ExternalFieldValue;
}

/** A group of writes against one external source. */
export interface WriteBatch
{
    Source: string;
    IdKey: string;
    Operations: readonly WriteOperation[];
    VersionField?: string;
}

/** A write that was refused rather than applied. */
export interface WriteConflict
{
    Key: ExternalFieldValue;
    Reason: string;
}

/** Outcome of applying a write batch. */
export interface WriteResult
{
    Applied: number;
    Conflicts: readonly WriteConflict[];
}

/** The minimal resolved connection shape handed to an adapter. */
export interface ResolvedConnection
{
    Kind: DataSourceKind;
    Config: Record<string, string>;
    /** The RESOLVED secret value handed to the adapter (not the secret's name). */
    Secret?: string;
}

/** Deterministic projections over a {@link ModelConnectorPlan}. */
export class ConnectorPlanProjection
{
    /**
     * Returns a sorted copy (connectors by Name, bindings by Concept, FieldMap
     * keys sorted) for byte-stable codegen and order-independent comparison.
     * Never mutates the input.
     */
    public static Normalize(plan: ModelConnectorPlan): ModelConnectorPlan
    {
        return {
            ...plan,
            Connectors: plan.Connectors
                .map((c) => ({ ...c, Config: ConnectorPlanProjection.SortKeys(c.Config) }))
                .sort((a, b) => ConnectorPlanProjection.Compare(a.Name, b.Name)),
            Bindings: plan.Bindings
                .map((b) => ({ ...b, FieldMap: ConnectorPlanProjection.SortKeys(b.FieldMap) }))
                .sort((a, b) => ConnectorPlanProjection.Compare(a.Concept, b.Concept)),
        };
    }

    // Intentionally code-unit (not locale) ordering: byte-stable output across machines; do not swap in localeCompare.
    private static Compare(a: string, b: string): number
    {
        if (a < b) return -1;
        return a > b ? 1 : 0;
    }

    private static SortKeys(source: Record<string, string>): Record<string, string>
    {
        const result: Record<string, string> = {};
        for (const key of Object.keys(source).sort(ConnectorPlanProjection.Compare))
        {
            result[key] = source[key]!;
        }
        return result;
    }
}

/** Single home for resolving a binding's connector name to its spec within a plan. */
export class ConnectorLookup
{
    private static readonly UnknownConnectorPrefix = "binding for '";
    private static readonly UnknownConnectorMiddle = "' references unknown connector '";
    private static readonly UnknownConnectorSuffix = "'";

    public static Find(connectors: readonly ConnectorSpec[], binding: ConnectorBinding): ConnectorSpec
    {
        const spec = connectors.find(candidate => candidate.Name === binding.Connector);
        if (!spec)
        {
            throw new Error(`${ConnectorLookup.UnknownConnectorPrefix}${binding.Concept}`
                + `${ConnectorLookup.UnknownConnectorMiddle}${binding.Connector}`
                + ConnectorLookup.UnknownConnectorSuffix);
        }
        return spec;
    }
}

/** One source a merged canonical must write back to: the external record key + the datasource/source that owns it. */
export interface WriteTarget
{
    readonly StorageId: string;
    readonly Connector: string;
    readonly Source: string;
}
