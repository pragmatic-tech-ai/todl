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
    /** Who assigns new rows' keys: absent = {@link KeyAssignment.Client}. Authored as `keys source;`. */
    KeyAssignment?: KeyAssignment;
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

/** Comparison operator of a filter term. Semantics are SQL's (see QueryFilterEvaluator): a NULL field satisfies only
 *  IsNull; every other comparison against NULL excludes the row. */
export enum QueryCompareOp
{
    Eq = "eq",
    Neq = "neq",
    Lt = "lt",
    Lte = "lte",
    Gt = "gt",
    Gte = "gte",
    /** Field equals one of Values (an empty Values matches nothing). */
    In = "in",
    IsNull = "isNull",
    IsNotNull = "isNotNull",
}

/** One field comparison in a filter. Value is the operand of Eq..Gte (ignored by In / IsNull / IsNotNull); Values is In's set. */
export interface QueryComparison
{
    Field: string;
    Op: QueryCompareOp;
    Value: ExternalFieldValue;
    Values?: readonly ExternalFieldValue[];
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
    /** The id column to sort/seek on when paging; absent -> falls back to Fields[0]. */
    OrderKey?: string;
}

/** The kind of write an adapter applies to one record. */
export enum WriteOperationKind
{
    Upsert = "upsert",
    Delete = "delete",
    /** A source-keyed insert: the source assigns the key, reported back in {@link WriteResult.Assigned} by {@link WriteOperation.Ref}. */
    Insert = "insert",
}

/** One record write; Fields are already in EXTERNAL field names. */
export interface WriteOperation
{
    Kind: WriteOperationKind;
    Key: ExternalFieldValue;
    Fields: Record<string, ExternalFieldValue>;
    /** Expected prior version (optimistic mode). */
    Version?: ExternalFieldValue;
    /** The caller's reference for a source-keyed {@link WriteOperationKind.Insert}: the key the source assigns is reported
     *  back under this Ref (the key is null until then). Absent for Upsert and Delete. */
    Ref?: string;
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

/** Who assigns the key of a newly inserted row: the client (default) or the external source. */
export enum KeyAssignment
{
    Client = "client",
    Source = "source",
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

/** One source-assigned key reported by an {@link WriteOperationKind.Insert}, naming the {@link WriteOperation.Ref} it answers. */
export interface IAssignedKey
{
    /** The Ref of the insert this key answers (the contract: keyed by Ref, order irrelevant). */
    Ref: string;
    /** The key the source assigned. */
    Key: ExternalFieldValue;
    /** The version the source set on the inserted row, when it has a version field. */
    Version?: ExternalFieldValue;
}

/** Outcome of applying a write batch. */
export interface WriteResult
{
    Applied: number;
    Failures: readonly WriteFailure[];
    /** The version each applied optimistic upsert now carries, when it was bumped on write (VersionBumpingAdapter). */
    Versions?: readonly { Key: ExternalFieldValue; Version: ExternalFieldValue }[];
    /** The key the source assigned each applied {@link WriteOperationKind.Insert}, keyed by {@link WriteOperation.Ref}; order irrelevant. */
    Assigned?: readonly IAssignedKey[];
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
    private static readonly GraphQlSuffix = "', which cannot version writes (declare versionArg and versionArgType on the connector)";
    private static readonly VersionArgKey = "versionArg";
    private static readonly VersionArgTypeKey = "versionArgType";
    private static readonly VersionArgPairMessage = "' must declare versionArg and versionArgType together";
    private static readonly UpsertArgsKey = "upsertArgs";
    private static readonly FilterArgsKey = "filterArgs";
    private static readonly UpsertKeyArgKey = "upsertKeyArg";
    private static readonly TypedArgEntrySeparator = /\s*,\s*/;
    // The source-field side of a `field=arg:Type` entry (the adapter's DeclaredFilters field grammar).
    private static readonly SourceFieldPattern = /^[_A-Za-z][_0-9A-Za-z.-]*$/;
    private static readonly TypedArgPairSeparator = "=";
    private static readonly TypedArgTypeSeparator = ":";
    private static readonly MalformedTypedArgMiddle = "' has a malformed 'field=arg:Type' entry: '";
    private static readonly InvalidTypeMiddle = "' is not a valid GraphQL type: '";
    // A named GraphQL input type, optionally a list and/or non-null (e.g. Int, ID!, [String!]!).
    private static readonly GraphQlTypePattern = /^\[?[_A-Za-z][_0-9A-Za-z]*!?\]?!?$/;
    private static readonly GraphQlStyleKey = "style";
    private static readonly GraphQlStyleValue = "graphql";
    private static readonly SourceKeysPrefix = "binding for '";
    private static readonly SourceKeysReadOnlySuffix = "' declares keys source but is read-only";

    // GraphQL write-config keys carried in ConnectorSpec.Config, mirrored from the host adapter's
    // GraphQlConnectionConfig (a higher layer we cannot import). An authored value that would make
    // the adapter throw at construction is caught here instead, as a plan-build error (#5).
    private static readonly UpsertInputTypeKey = "upsertInputType";
    private static readonly UpsertInputArgKey = "upsertInputArg";
    private static readonly UpsertReturnKey = "upsertReturn";
    private static readonly DeleteIdTypeKey = "deleteIdType";
    private static readonly DeleteIdArgKey = "deleteIdArg";
    private static readonly UpsertMutationKey = "upsertMutation";
    private static readonly DeleteMutationKey = "deleteMutation";
    // The single-identifier keys (type/arg names + mutation names); upsertReturn (a space/comma list) is validated field-by-field.
    private static readonly GraphQlIdentifierKeys: readonly string[] = [
        ConnectorPlanValidator.UpsertInputTypeKey,
        ConnectorPlanValidator.UpsertInputArgKey,
        ConnectorPlanValidator.DeleteIdTypeKey,
        ConnectorPlanValidator.DeleteIdArgKey,
        ConnectorPlanValidator.UpsertMutationKey,
        ConnectorPlanValidator.DeleteMutationKey,
        ConnectorPlanValidator.VersionArgKey,
    ];
    // GraphQL identifier rule, mirrored from the host's GraphQlName.Pattern (no upward import).
    private static readonly GraphQlNamePattern = /^[_A-Za-z][_0-9A-Za-z]*$/;
    // upsertReturn is a space-or-comma-separated field list (matches the adapter's ReturnFieldSeparator).
    private static readonly ReturnFieldSeparator = /[\s,]+/;
    private static readonly InvalidIdentifierPrefix = "graphql connector '";
    private static readonly InvalidIdentifierKeyMiddle = "' config key '";
    private static readonly InvalidIdentifierValueMiddle = "' is not a valid GraphQL identifier: '";
    private static readonly InvalidIdentifierSuffix = "'";

    /** Throws on the first write-mode or GraphQL write-config violation that cannot be honored. */
    public static Validate(plan: ModelConnectorPlan): void
    {
        for (const connector of plan.Connectors)
        {
            if (ConnectorPlanValidator.IsGraphQl(connector))
            {
                ConnectorPlanValidator.ValidateGraphQlWriteConfig(connector);
            }
        }
        for (const binding of plan.Bindings)
        {
            if (binding.KeyAssignment === KeyAssignment.Source && !binding.Writable)
            {
                throw new Error(`${ConnectorPlanValidator.SourceKeysPrefix}${binding.Concept}`
                    + ConnectorPlanValidator.SourceKeysReadOnlySuffix);
            }
            if (binding.Concurrency === WriteConcurrency.Optimistic)
            {
                ConnectorPlanValidator.ValidateOptimistic(plan.Connectors, binding);
            }
        }
    }

    /** Validates the authored GraphQL write-config keys on a connector: the input/id type and arg
     *  names and each upsertReturn field must be valid GraphQL identifiers. The errorConflictCodes /
     *  errorUnsupportedCodes comma-lists are accepted LENIENTLY (parsed the way the adapter parses
     *  them — empty items ignored; a wholly empty/separator-only value is simply "no codes") and so
     *  can never be a plan-build error. Absent keys reproduce the adapter's JSON!/ID!/input/id
     *  defaults, and a connector authored with only raw Config keys still validates (back-compat). */
    private static ValidateGraphQlWriteConfig(spec: ConnectorSpec): void
    {
        for (const key of ConnectorPlanValidator.GraphQlIdentifierKeys)
        {
            const value = spec.Config[key];
            if (value !== undefined)
            {
                ConnectorPlanValidator.RequireGraphQlName(spec.Name, key, value);
            }
        }
        const versionArg = spec.Config[ConnectorPlanValidator.VersionArgKey];
        const versionType = spec.Config[ConnectorPlanValidator.VersionArgTypeKey]?.trim();
        if ((versionArg === undefined) !== (versionType === undefined))
        {
            throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${spec.Name}${ConnectorPlanValidator.VersionArgPairMessage}`);
        }
        if (versionType !== undefined && !ConnectorPlanValidator.GraphQlTypePattern.test(versionType))
        {
            throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${spec.Name}${ConnectorPlanValidator.InvalidIdentifierKeyMiddle}`
                + `${ConnectorPlanValidator.VersionArgTypeKey}${ConnectorPlanValidator.InvalidTypeMiddle}${versionType}${ConnectorPlanValidator.InvalidIdentifierSuffix}`);
        }
        for (const key of [ConnectorPlanValidator.UpsertArgsKey, ConnectorPlanValidator.FilterArgsKey])
        {
            const list = spec.Config[key];
            if (list === undefined || list.trim().length === 0) continue;
            for (const entry of list.trim().split(ConnectorPlanValidator.TypedArgEntrySeparator).filter((e) => e.length > 0))
            {
                const [field, target, ...rest] = entry.split(ConnectorPlanValidator.TypedArgPairSeparator);
                if (field === undefined || !ConnectorPlanValidator.SourceFieldPattern.test(field.trim()) || target === undefined || rest.length > 0)
                {
                    throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${spec.Name}${ConnectorPlanValidator.InvalidIdentifierKeyMiddle}${key}${ConnectorPlanValidator.MalformedTypedArgMiddle}${entry}${ConnectorPlanValidator.InvalidIdentifierSuffix}`);
                }
                ConnectorPlanValidator.ValidateTypedArg(spec, key, target);
            }
        }
        const keyArg = spec.Config[ConnectorPlanValidator.UpsertKeyArgKey];
        if (keyArg !== undefined) ConnectorPlanValidator.ValidateTypedArg(spec, ConnectorPlanValidator.UpsertKeyArgKey, keyArg);
        const returnList = spec.Config[ConnectorPlanValidator.UpsertReturnKey];
        if (returnList !== undefined)
        {
            for (const field of returnList.split(ConnectorPlanValidator.ReturnFieldSeparator))
            {
                if (field.length > 0)
                {
                    ConnectorPlanValidator.RequireGraphQlName(spec.Name, ConnectorPlanValidator.UpsertReturnKey, field);
                }
            }
        }
    }

    /** `arg:Type`: a GraphQL argument name and a GraphQL input type (the adapter's grammar). */
    private static ValidateTypedArg(spec: ConnectorSpec, key: string, typedArg: string): void
    {
        const [arg, type, ...rest] = typedArg.split(ConnectorPlanValidator.TypedArgTypeSeparator).map((p) => p.trim());
        if (arg === undefined || type === undefined || rest.length > 0)
        {
            throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${spec.Name}${ConnectorPlanValidator.InvalidIdentifierKeyMiddle}${key}${ConnectorPlanValidator.MalformedTypedArgMiddle}${typedArg}${ConnectorPlanValidator.InvalidIdentifierSuffix}`);
        }
        ConnectorPlanValidator.RequireGraphQlName(spec.Name, key, arg);
        if (!ConnectorPlanValidator.GraphQlTypePattern.test(type))
        {
            throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${spec.Name}${ConnectorPlanValidator.InvalidIdentifierKeyMiddle}`
                + `${key}${ConnectorPlanValidator.InvalidTypeMiddle}${type}${ConnectorPlanValidator.InvalidIdentifierSuffix}`);
        }
    }

    private static RequireGraphQlName(connector: string, key: string, value: string): void
    {
        if (!ConnectorPlanValidator.GraphQlNamePattern.test(value))
        {
            throw new Error(`${ConnectorPlanValidator.InvalidIdentifierPrefix}${connector}`
                + `${ConnectorPlanValidator.InvalidIdentifierKeyMiddle}${key}`
                + `${ConnectorPlanValidator.InvalidIdentifierValueMiddle}${value}`
                + ConnectorPlanValidator.InvalidIdentifierSuffix);
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
        const spec = ConnectorLookup.TryFind(connectors, binding);
        // GraphQL can version only when the connector declares the mutation argument that carries the expected version.
        if (ConnectorPlanValidator.IsGraphQl(spec) && spec!.Config[ConnectorPlanValidator.VersionArgKey] === undefined)
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
