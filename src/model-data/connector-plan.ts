import type { Scalar } from "../compiler-services/model/graph.js";

/** The kind of external datasource a connector talks to. */
export enum DataSourceKind
{
    Sql = "sql",
    Rest = "rest",
    Cypher = "cypher",
    Document = "document",
    Builtin = "builtin",
}

/** A named connector declared by a model. */
export interface ConnectorSpec
{
    /** The connector's namespace-qualified id (the declaration's identity). Emitted
     *  from the compiled connector node; absent in hand-written specs. The adapter
     *  catalog keys its per-connector memo on this (falling back to Name), so two
     *  connectors that share a bare Name across namespaces no longer collide on one
     *  memoized adapter. */
    Id?: string;
    Name: string;
    Kind: DataSourceKind;
    Connection?: string;
    Config: Record<string, string>;
    Secret?: string;
    /** Names an adapter PROVIDER pack that supplies this connector's factory (as
     *  opposed to inline Kind-based resolution). Authored as `provider = "..."` and
     *  gated by the deployment ConnectionPolicy; carried through codegen so a
     *  published plan preserves the authored provider. Absent in hand-written specs. */
    Provider?: string;
}

/** Binds a concept to a source (table, endpoint, ...) on a connector. */
export interface ConnectorBinding
{
    Concept: string;
    Connector: string;
    /** The connector's namespace-qualified id (its {@link ConnectorSpec.Id}), used to LINK
     *  this binding to its spec unambiguously when two connectors share a bare Name across
     *  namespaces. The bare Connector name is retained for the source/provenance tag and the
     *  minted node-id scheme. Absent in hand-written/legacy plans, which link by Connector. */
    ConnectorId?: string;
    Source: string;
    IdKey: string;
    FieldMap: Record<string, string>;
    Writable: boolean;
    /** External version/etag column guarding optimistic writes; absent = last-write-wins. */
    VersionField?: string;
    /** Concurrency axis for writes to this binding. Authored in TODL source (`concurrency ...`) and
     *  defaulted to {@link WriteConcurrency.LastWriteWins} on plan-build when the source omits it. */
    Concurrency: WriteConcurrency;
    /** Atomicity axis for writes to this binding. Authored in TODL source (`atomicity ...`) and
     *  defaulted to {@link WriteAtomicity.Sequential} on plan-build when the source omits it. */
    Atomicity: WriteAtomicity;
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

/** Concurrency axis of a write: how an upsert guards against a concurrent change. */
export enum WriteConcurrency
{
    LastWriteWins = "last-write-wins",
    Optimistic = "optimistic",
}

/** Atomicity axis of a write batch: how a mid-batch failure is handled. */
export enum WriteAtomicity
{
    Sequential = "sequential",
    Transactional = "transactional",
}

/** Why a single write did not persist. */
export enum WriteFailureKind
{
    Conflict = "conflict",
    Error = "error",
    Unsupported = "unsupported",
}

/** A group of writes against one external source. */
export interface WriteBatch
{
    Source: string;
    IdKey: string;
    Operations: readonly WriteOperation[];
    Concurrency: WriteConcurrency;
    Atomicity: WriteAtomicity;
    VersionField?: string;
}

/** A single write that did not persist, with a typed reason. */
export interface WriteFailure
{
    Key: ExternalFieldValue;
    Kind: WriteFailureKind;
    Reason: string;
}

/** Outcome of applying a write batch. */
export interface WriteResult
{
    Applied: number;
    Failures: readonly WriteFailure[];
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
        const spec = ConnectorLookup.TryFind(connectors, binding);
        if (!spec)
        {
            throw new Error(`${ConnectorLookup.UnknownConnectorPrefix}${binding.Concept}`
                + `${ConnectorLookup.UnknownConnectorMiddle}${binding.Connector}`
                + ConnectorLookup.UnknownConnectorSuffix);
        }
        return spec;
    }

    /** Resolves a binding's connector to its spec, or undefined when none matches. Links by
     *  the binding's qualified {@link ConnectorBinding.ConnectorId} when present (matched
     *  against each spec's {@link ConnectorSpec.Id}), falling back to the bare Connector name
     *  (matched against Name) for hand-written/legacy plans. */
    public static TryFind(connectors: readonly ConnectorSpec[], binding: ConnectorBinding): ConnectorSpec | undefined
    {
        const key = binding.ConnectorId ?? binding.Connector;
        return connectors.find(candidate => (candidate.Id ?? candidate.Name) === key);
    }
}

/** Plan-build validation of the write-mode axes authored on each binding. Runs when a
 *  {@link ModelConnectorPlan} is finalized (the emitter's build path); a violation is a
 *  hard plan-build error, never a silent downgrade to last-write-wins (#5). */
export class ConnectorPlanValidator
{
    private static readonly BindingPrefix = "optimistic binding for '";
    private static readonly NoVersionSuffix = "' requires a version field";
    private static readonly AbsentVersionMiddle = "' names version field '";
    private static readonly AbsentVersionSuffix = "' which is not in its field map";
    private static readonly GraphQlMiddle = "' targets GraphQL connector '";
    private static readonly GraphQlSuffix = "', which cannot version writes";
    private static readonly GraphQlStyleKey = "style";
    private static readonly GraphQlStyleValue = "graphql";

    /** Throws on the first optimistic binding that cannot be honored. */
    public static Validate(plan: ModelConnectorPlan): void
    {
        for (const binding of plan.Bindings)
        {
            if (binding.Concurrency === WriteConcurrency.Optimistic)
            {
                ConnectorPlanValidator.ValidateOptimistic(plan.Connectors, binding);
            }
        }
    }

    private static ValidateOptimistic(connectors: readonly ConnectorSpec[], binding: ConnectorBinding): void
    {
        if (binding.VersionField === undefined || binding.VersionField === "")
        {
            throw new Error(`${ConnectorPlanValidator.BindingPrefix}${binding.Concept}`
                + ConnectorPlanValidator.NoVersionSuffix);
        }
        if (!ConnectorPlanValidator.InFieldMap(binding.FieldMap, binding.VersionField))
        {
            throw new Error(`${ConnectorPlanValidator.BindingPrefix}${binding.Concept}`
                + `${ConnectorPlanValidator.AbsentVersionMiddle}${binding.VersionField}`
                + ConnectorPlanValidator.AbsentVersionSuffix);
        }
        if (ConnectorPlanValidator.IsGraphQl(ConnectorLookup.TryFind(connectors, binding)))
        {
            throw new Error(`${ConnectorPlanValidator.BindingPrefix}${binding.Concept}`
                + `${ConnectorPlanValidator.GraphQlMiddle}${binding.Connector}`
                + ConnectorPlanValidator.GraphQlSuffix);
        }
    }

    /** A version field "is in the field map" when it is a mapped external field (a value)
     *  or a member name (a key) — either way working-copy can resolve its version. */
    private static InFieldMap(fieldMap: Readonly<Record<string, string>>, versionField: string): boolean
    {
        return versionField in fieldMap || Object.values(fieldMap).includes(versionField);
    }

    /** GraphQL is identified the way the adapter factory does: a REST connector whose
     *  `style` config is `graphql` (RestAdapterFactory selects the GraphQL transport on it). */
    private static IsGraphQl(spec: ConnectorSpec | undefined): boolean
    {
        return spec !== undefined
            && spec.Kind === DataSourceKind.Rest
            && spec.Config[ConnectorPlanValidator.GraphQlStyleKey] === ConnectorPlanValidator.GraphQlStyleValue;
    }
}

/** One source a merged canonical must write back to: the external record key + the datasource/source that owns it. */
export interface WriteTarget
{
    readonly StorageId: string;
    readonly Connector: string;
    readonly Source: string;
}
