import type { IGraphQuery } from "../graph-api/index.js";
import type { IConnectorQueryFilterProvider } from "../model-data/federated-model-data-connector.js";
import { QueryCompareOp, type QueryComparison, type QueryFilter } from "../model-data/connector-plan.js";
import type { Scalar } from "../manifest/logical.js";
import { BooleanOp, ComparisonOp } from "./enums.js";
import { BooleanExpression, Comparison, Literal, Parameter, PropertyAccess, type Expression } from "./expressions.js";
import { GraphQueryAdapter } from "./graph.js";
import { CypherParser } from "./parser.js";
import { MatchClause, UnwindClause, type CypherQueryModel } from "./query-model.js";
import type { NodePattern } from "./patterns.js";
import type { ParameterValue } from "./values.js";

/** The schema facts push-down needs: which concept a label names, and which concepts a label's scan also matches. */
export interface ICypherSchema
{
    /** The concept a label names; throws when the label is unknown or ambiguous. */
    ResolveConcept(label: string): string;
    /** True when a scan of concept `label` also yields instances of concept `instance` (same concept or a supertype). */
    Matches(label: string, instance: string): boolean;
}

/** {@link ICypherSchema} over a schema-level graph query. */
export class GraphQuerySchema implements ICypherSchema
{
    private readonly labels: GraphQueryAdapter;

    constructor(private readonly query: IGraphQuery)
    {
        this.labels = new GraphQueryAdapter(query);
    }

    public ResolveConcept(label: string): string
    {
        return this.labels.ResolveConcept(label);
    }

    public Matches(label: string, instance: string): boolean
    {
        const scanned = this.query.Type(label);
        const actual = this.query.Type(instance);
        return scanned !== undefined && actual !== undefined && scanned.isAssignableFrom(actual);
    }
}

/** The per-concept filters one Cypher query lets a connector push into its source query (model member names). */
export class CypherQueryFilterProvider implements IConnectorQueryFilterProvider
{
    public static readonly None = new CypherQueryFilterProvider(new Map());

    constructor(private readonly filters: ReadonlyMap<string, QueryFilter>)
    {
    }

    public WhereFor(concept: string): QueryFilter | undefined
    {
        return this.filters.get(concept);
    }

    /** The concepts this query filters at the source. */
    public Concepts(): string[]
    {
        return [...this.filters.keys()].sort();
    }
}

/** One labeled node pattern of the query: the concept it scans, and the MATCH it sits in. */
class LabeledOccurrence
{
    constructor(readonly Concept: string, readonly Node: NodePattern, readonly Clause: MatchClause)
    {
    }
}

/**
 * Derives a SOUND source filter from a read-only Cypher query: every row the query can return survives the pushed
 * filter, and the in-memory engine still evaluates the full WHERE over what was pulled. A concept is filtered only when
 * exactly one node pattern in the whole query can scan its instances (no other label naming it or a supertype, no
 * unlabeled fresh node, no variable-length hop), that pattern sits in a non-optional MATCH, and the filter is the
 * conjunction of its inline properties plus the MATCH's top-level `AND` terms of the form `v.p = literal | $param`.
 * Only equality is pushed: source-side equality can only widen (coercion, case-insensitive collation), never narrow,
 * while `<>` and ranges can narrow. Anything the analyzer cannot prove safe yields no filter.
 * Soundness is per ROW: it assumes each pulled record is one entity. A consumer that merges records into one entity
 * (identity resolution) must not push for such concepts (FederatedModelDataConnector gates on MergeFreeConcepts).
 */
export class CypherPushDown
{
    private static readonly AnalysisAborted = new Error("push-down analysis aborted");

    public static Analyze(
        source: string | CypherQueryModel,
        schema: ICypherSchema,
        parameters: ReadonlyMap<string, ParameterValue> = new Map(),
    ): CypherQueryFilterProvider
    {
        try
        {
            const model = typeof source === "string" ? new CypherParser(source).Parse() : source;
            if (model.HasWrites()) return CypherQueryFilterProvider.None;
            return new CypherQueryFilterProvider(new CypherPushDown(schema, parameters).filtersOf(model));
        }
        catch
        {
            return CypherQueryFilterProvider.None;
        }
    }

    private constructor(private readonly schema: ICypherSchema, private readonly parameters: ReadonlyMap<string, ParameterValue>)
    {
    }

    private filtersOf(model: CypherQueryModel): Map<string, QueryFilter>
    {
        const occurrences = this.occurrencesOf(model);
        const filters = new Map<string, QueryFilter>();
        for (const occurrence of occurrences)
        {
            if (occurrence.Clause.Optional) continue;
            const scanners = occurrences.filter((o) => this.schema.Matches(o.Concept, occurrence.Concept));
            if (scanners.length !== 1) continue;
            const terms = this.termsOf(occurrence);
            if (terms.length > 0) filters.set(occurrence.Concept, { All: terms });
        }
        return filters;
    }

    // Every labeled node pattern, in query order. Throws (aborting analysis) on a scan that could reach any concept: an
    // unlabeled node that is not a reference to an already-bound variable, or a variable-length hop.
    private occurrencesOf(model: CypherQueryModel): LabeledOccurrence[]
    {
        const out: LabeledOccurrence[] = [];
        let scope = new Set<string>();
        for (const part of model.Parts)
        {
            for (const clause of part.Reading)
            {
                if (clause instanceof UnwindClause)
                {
                    scope.add(clause.Variable);
                    continue;
                }
                if (!(clause instanceof MatchClause)) throw CypherPushDown.AnalysisAborted;
                for (const path of clause.Paths)
                {
                    if (path.Rels.some((r) => r.IsVariableLength)) throw CypherPushDown.AnalysisAborted;
                    for (const node of path.Nodes)
                    {
                        if (node.Label !== undefined)
                        {
                            out.push(new LabeledOccurrence(this.schema.ResolveConcept(node.Label), node, clause));
                        }
                        else if (node.Variable === undefined || !scope.has(node.Variable))
                        {
                            throw CypherPushDown.AnalysisAborted;
                        }
                        if (node.Variable !== undefined) scope.add(node.Variable);
                    }
                    for (const rel of path.Rels) if (rel.Variable !== undefined) scope.add(rel.Variable);
                    if (path.PathVariable !== undefined) scope.add(path.PathVariable);
                }
            }
            if (part.Projection !== undefined) scope = new Set(part.Projection.Items.map((i) => i.ColumnName()));
        }
        return out;
    }

    private termsOf(occurrence: LabeledOccurrence): QueryComparison[]
    {
        const terms: QueryComparison[] = [];
        for (const [field, value] of occurrence.Node.Properties)
        {
            if (CypherPushDown.Pushable(value)) terms.push({ Field: field, Op: QueryCompareOp.Eq, Value: value });
        }
        const variable = occurrence.Node.Variable;
        const where = occurrence.Clause.Where;
        if (variable === undefined || where === undefined) return terms;
        for (const conjunct of CypherPushDown.Conjuncts(where.Predicate))
        {
            const term = this.termOf(conjunct, variable);
            if (term !== undefined) terms.push(term);
        }
        return terms;
    }

    private static Conjuncts(predicate: Expression): Expression[]
    {
        if (predicate instanceof BooleanExpression && predicate.Op === BooleanOp.And)
        {
            return predicate.Operands.flatMap((o) => CypherPushDown.Conjuncts(o));
        }
        return [predicate];
    }

    private termOf(conjunct: Expression, variable: string): QueryComparison | undefined
    {
        if (!(conjunct instanceof Comparison) || conjunct.Op !== ComparisonOp.Eq) return undefined;
        const [property, other] = conjunct.Left instanceof PropertyAccess ? [conjunct.Left, conjunct.Right] : [conjunct.Right, conjunct.Left];
        if (!(property instanceof PropertyAccess) || property.Variable !== variable) return undefined;
        const value = this.constantOf(other);
        return value === undefined ? undefined : { Field: property.Property, Op: QueryCompareOp.Eq, Value: value };
    }

    private constantOf(expression: Expression): Scalar | undefined
    {
        let value: ParameterValue | undefined;
        if (expression instanceof Literal) value = expression.Value;
        else if (expression instanceof Parameter) value = this.parameters.get(expression.Name);
        return CypherPushDown.Pushable(value) ? value : undefined;
    }

    // Null never equals anything in Cypher, and a non-finite number has no portable source-side spelling.
    private static Pushable(value: ParameterValue | undefined): value is Scalar
    {
        if (typeof value === "string" || typeof value === "boolean") return true;
        return typeof value === "number" && Number.isFinite(value);
    }
}
