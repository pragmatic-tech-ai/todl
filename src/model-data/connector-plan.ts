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

/** A read request against a source. */
export interface QueryRequest
{
    Source: string;
    Fields: readonly string[];
}

/** The minimal resolved connection shape handed to an adapter. */
export interface ResolvedConnection
{
    Kind: DataSourceKind;
    Config: Record<string, string>;
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
