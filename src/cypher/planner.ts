import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";
import type { NodePattern, PatternPath } from "./patterns.js";
import type { CypherQueryModel, QueryPart, ProjectionClause, ReturnItem } from "./query-model.js";
import { MatchClause, UnwindClause, WritingClause, SortItem, CreateClause, MergeClause, SetClause, DeleteClause, RemoveClause } from "./query-model.js";
import { CypherSemanticError } from "./errors.js";
import { ComparisonOp } from "./enums.js";
import type { Expression } from "./expressions.js";
import { Comparison, PropertyAccess, VariableRef, Literal, FunctionCall } from "./expressions.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue, ScalarValue } from "./values.js";
import { VarLengthExpand } from "./operators-varlength.js";
import { IOperator, AllNodesScan, LabelScan, Expand, ExpandInto, Filter, LabelFilter, Project, SingleRow, BindingRow } from "./operators.js";
import { Unwind } from "./operators-unwind.js";
import { CreateOperator, MergeOperator, SetOperator, DeleteOperator, RemoveOperator } from "./operators-write.js";
import type { ICypherWriter } from "./writer.js";
import { CartesianProduct } from "./operators-join.js";
import { OptionalApply } from "./operators-optional.js";
import type { IOptionalPlan } from "./operators-optional.js";
import { Aggregate } from "./operators-aggregate.js";
import type { AggregateItem } from "./operators-aggregate.js";
import type { ICancellation } from "./execution-limits.js";
import { Sort, Skip, Limit, Distinct } from "./operators-ordering.js";

export interface PlannerOptions
{
    readonly MaxVarLength?: number;
    // Opt-in: reusing the name of a variable dropped by an earlier WITH as a new pattern variable throws.
    readonly StrictWithScope?: boolean;
}

class OptionalMatchPlan implements IOptionalPlan
{
    constructor(
        private readonly planner: LogicalPlanner,
        private readonly inner: MatchClause,
        private readonly outerBound: ReadonlySet<string>,
    )
    {
    }

    public Build(row: Binding): IOperator
    {
        return this.planner.CompileInner(row, this.inner, this.outerBound);
    }
}

export class LogicalPlanner
{
    private static readonly WritesNotExecutable = "write clauses require a writer";
    private static readonly AnonPrefix = "__n";
    private static readonly RelPropsUnsupported = "relationship properties are not supported";
    private static readonly UnknownRelType = "unknown relationship type";
    private static readonly UnknownOrderByColumn = "unknown ORDER BY column";
    private static readonly UnknownWhereColumn = "unknown WITH ... WHERE column";
    private static readonly UnboundVariable = "variable not in scope";
    private static readonly NonNumericLimit = "SKIP/LIMIT must evaluate to a number";
    private static readonly NestedAggregate = "aggregate functions must be a direct call in a projection item";
    private static readonly DefaultMaxVarLength = 15;
    private static readonly PathVarNeedsVarLength = "a path variable requires a variable-length relationship";
    private static readonly VarLengthIntoBoundUnsupported = "variable-length expansion into an already-bound node is not yet supported";

    private static readonly StrictScopeReuse = "variable reused after being dropped by an earlier WITH";

    private readonly maxVarLength: number;
    private readonly strictWithScope: boolean;

    constructor(
        private readonly graph: ICypherGraph,
        private readonly parameters: ReadonlyMap<string, CypherValue>,
        options?: PlannerOptions,
        private readonly cancel?: ICancellation,
        // Paging needs a stable order: when set, an unordered final RETURN is sorted by its first column (ascending).
        private readonly ensureOrder: boolean = false,
        // Optional: only write-capable plans (PlanForWrite) supply one; read planning omits it.
        private readonly writer?: ICypherWriter,
    )
    {
        // Variable-length wiring lands in a later task; the cap is accepted and carried now.
        this.maxVarLength = options?.MaxVarLength ?? LogicalPlanner.DefaultMaxVarLength;
        this.strictWithScope = options?.StrictWithScope ?? false;
    }

    public Plan(model: CypherQueryModel): IOperator
    {
        let inScope = new Set<string>();
        const everBound = new Set<string>();
        let op: IOperator | undefined = undefined;
        for (const part of model.Parts)
        {
            if (this.strictWithScope) this.checkStrictScope(part, inScope, everBound);
            op = this.compilePart(part, op, inScope, part === model.Parts[model.Parts.length - 1]);
            for (const v of this.readingVariables(part)) everBound.add(v);
            if (part.Projection === undefined) continue;
            for (const item of part.Projection.Items) everBound.add(item.ColumnName());
            if (!part.Projection.IsReturn)
            {
                inScope = new Set<string>(part.Projection.Items.map((i) => i.ColumnName()));
            }
        }
        // Parse/fluent invariants guarantee at least one part, so op is always assigned.
        return op!;
    }

    // Builds the full clause pipeline across all parts, but returns the FINAL part's projection separately so the
    // caller can run it post-commit via ProjectOver. Intermediate WITH projections stay inline (pre-query graph reads).
    public PlanForWrite(model: CypherQueryModel): { Mutations: IOperator; Projection: ProjectionClause | undefined }
    {
        let inScope = new Set<string>();
        const everBound = new Set<string>();
        let op: IOperator | undefined = undefined;
        let projection: ProjectionClause | undefined = undefined;
        const last = model.Parts[model.Parts.length - 1];
        for (const part of model.Parts)
        {
            const isFinal = part === last;
            if (this.strictWithScope) this.checkStrictScope(part, inScope, everBound);
            op = this.compilePart(part, op, inScope, isFinal, isFinal);
            if (isFinal) projection = part.Projection;
            for (const v of this.readingVariables(part)) everBound.add(v);
            if (part.Projection === undefined) continue;
            for (const item of part.Projection.Items) everBound.add(item.ColumnName());
            if (!part.Projection.IsReturn)
            {
                inScope = new Set<string>(part.Projection.Items.map((i) => i.ColumnName()));
            }
        }
        return { Mutations: op!, Projection: projection };
    }

    public ProjectOver(source: IOperator, projection: ProjectionClause): IOperator
    {
        return this.buildProjection(source, projection, this.ensureOrder);
    }

    private readingVariables(part: QueryPart): Set<string>
    {
        const out = new Set<string>();
        for (const clause of part.Reading)
        {
            if (clause instanceof MatchClause) for (const v of clause.DeclaredVariables()) out.add(v);
            else if (clause instanceof UnwindClause) out.add(clause.Variable);
            else if (clause instanceof CreateClause || clause instanceof MergeClause) for (const v of clause.DeclaredVariables()) out.add(v);
        }
        return out;
    }

    // Strict mode: a MATCH/UNWIND variable bound in a PRIOR segment but not carried into this
    // segment's inScope is a dropped-then-reused name; reject it.
    private checkStrictScope(part: QueryPart, inScope: ReadonlySet<string>, everBound: ReadonlySet<string>): void
    {
        for (const v of this.readingVariables(part))
        {
            if (!inScope.has(v) && everBound.has(v))
            {
                throw new CypherSemanticError(`${LogicalPlanner.StrictScopeReuse}: "${v}"`);
            }
        }
    }

    private compilePart(part: QueryPart, input: IOperator | undefined, inScope: ReadonlySet<string>, isFinal: boolean, deferProjection: boolean = false): IOperator
    {
        const declared = new Set<string>(inScope);
        for (const v of this.readingVariables(part)) declared.add(v);
        this.validateScope(part, declared);

        const pipelineBound = new Set<string>(inScope);
        let op = input;
        for (const clause of part.Reading)
        {
            if (clause instanceof MatchClause)
            {
                op = this.compileMatch(op, clause, pipelineBound);
            }
            else if (clause instanceof UnwindClause)
            {
                op = new Unwind(op ?? new SingleRow(), clause.Expr, clause.Variable, this.parameters);
                pipelineBound.add(clause.Variable);
            }
            else if (clause instanceof WritingClause)
            {
                op = this.compileWrite(op ?? new SingleRow(), clause, pipelineBound);
            }
        }
        if (op === undefined) op = new SingleRow();
        if (part.Projection === undefined || deferProjection) return op;
        return this.buildProjection(op, part.Projection, isFinal && this.ensureOrder);
    }

    private compileWrite(op: IOperator, clause: WritingClause, bound: Set<string>): IOperator
    {
        const writer = this.writer;
        if (writer === undefined) throw new CypherSemanticError(LogicalPlanner.WritesNotExecutable);
        const g = this.graph;
        const p = this.parameters;
        if (clause instanceof CreateClause)
        {
            for (const v of clause.DeclaredVariables()) bound.add(v);
            return new CreateOperator(op, clause, g, writer);
        }
        if (clause instanceof MergeClause)
        {
            for (const v of clause.DeclaredVariables()) bound.add(v);
            return new MergeOperator(op, clause, g, writer);
        }
        if (clause instanceof SetClause) return new SetOperator(op, clause, g, writer, p);
        if (clause instanceof DeleteClause) return new DeleteOperator(op, clause, writer, p);
        if (clause instanceof RemoveClause) return new RemoveOperator(op, clause, writer);
        throw new CypherSemanticError(LogicalPlanner.WritesNotExecutable);
    }

    private validateScope(part: QueryPart, available: ReadonlySet<string>): void
    {
        const referenced = new Set<string>();
        for (const clause of part.Reading)
        {
            if (clause instanceof MatchClause) clause.Where?.Predicate.CollectVariables(referenced);
            else if (clause instanceof UnwindClause) clause.Expr.CollectVariables(referenced);
            else if (clause instanceof SetClause)
            {
                for (const item of clause.Items)
                {
                    referenced.add(item.Variable);
                    item.Value.CollectVariables(referenced);
                }
            }
            else if (clause instanceof DeleteClause) for (const t of clause.Targets) t.CollectVariables(referenced);
            else if (clause instanceof RemoveClause) for (const i of clause.Items) referenced.add(i.Variable);
        }
        for (const item of part.Projection?.Items ?? []) item.Expr.CollectVariables(referenced);
        // ORDER BY / SKIP / LIMIT may refer to projection aliases, so they are not scope-checked here.
        for (const v of referenced)
        {
            if (!available.has(v)) throw new CypherSemanticError(`${LogicalPlanner.UnboundVariable}: "${v}"`);
        }
    }

    // Planner-internal entry for OptionalMatchPlan (TypeScript has no friend access).
    // Public only so OptionalMatchPlan (a separate class in this file) can call it; not part of the planner API.
    public CompileInner(row: Binding, inner: MatchClause, outerBound: ReadonlySet<string>): IOperator
    {
        return this.compileMatch(new BindingRow(row), inner, new Set<string>(outerBound));
    }

    private compileMatch(input: IOperator | undefined, match: MatchClause, bound: Set<string>): IOperator
    {
        if (match.Optional)
        {
            return this.compileOptionalMatch(input, match, bound);
        }
        let op = input;
        for (const path of match.Paths)
        {
            op = this.compilePath(op, path, bound);
        }
        if (op === undefined) op = new SingleRow();
        if (match.Where !== undefined) op = new Filter(op, match.Where.Predicate, this.parameters);
        return op;
    }

    private compileOptionalMatch(input: IOperator | undefined, match: MatchClause, bound: Set<string>): IOperator
    {
        const source = input ?? new SingleRow();
        const outerBound = new Set<string>(bound);
        const optionalVars = [...match.DeclaredVariables()].filter((v) => !outerBound.has(v));
        const inner = new MatchClause(match.Paths, match.Where, false);
        const plan = new OptionalMatchPlan(this, inner, outerBound);
        for (const v of optionalVars) bound.add(v);
        return new OptionalApply(source, plan, optionalVars);
    }

    private compilePath(input: IOperator | undefined, path: PatternPath, bound: Set<string>): IOperator
    {
        this.validateRels(path);
        const names = path.Nodes.map((n, i) => n.Variable ?? `${LogicalPlanner.AnonPrefix}${i}`);
        const anchor = path.Nodes[0]!;
        const anchorReused = anchor.Variable !== undefined && bound.has(anchor.Variable) && input !== undefined;

        let op: IOperator;
        if (anchorReused)
        {
            op = this.foldReusedConstraints(input, anchor, names[0]!);
        }
        else
        {
            const scan = this.anchor(anchor, names[0]!);
            op = input === undefined ? scan : new CartesianProduct(input, scan, this.cancel);
            op = this.foldNodeProperties(op, anchor, names[0]!);
            if (anchor.Variable !== undefined) bound.add(anchor.Variable);
        }

        // Limitation: a path variable binds the PathValue of the LAST variable-length rel in the path
        // (exact for the common single-rel case); fixed-only paths cannot bind one yet.
        let pathVarRel = -1;
        for (let i = 0; i < path.Rels.length; i++) if (path.Rels[i]!.IsVariableLength) pathVarRel = i;
        if (path.PathVariable !== undefined && pathVarRel < 0)
        {
            throw new CypherSemanticError(LogicalPlanner.PathVarNeedsVarLength);
        }

        for (let i = 0; i < path.Rels.length; i++)
        {
            const rel = path.Rels[i]!;
            const toNode = path.Nodes[i + 1]!;
            const targetBound = toNode.Variable !== undefined && bound.has(toNode.Variable);
            if (rel.IsVariableLength)
            {
                // Var-length into an already-bound target (depth ranges + optional path variable) is a harder
                // case not yet implemented; a loud error beats silently clobbering the bound node.
                if (targetBound) throw new CypherSemanticError(LogicalPlanner.VarLengthIntoBoundUnsupported);
                const pathVar = i === pathVarRel ? path.PathVariable : undefined;
                op = new VarLengthExpand(op, this.graph, names[i]!, names[i + 1]!, rel.RelType, rel.Direction,
                    rel.MinHops ?? 1, rel.MaxHops ?? this.maxVarLength, toNode.Label, pathVar, rel.Variable, this.cancel);
            }
            else if (targetBound)
            {
                // Reusing a variable reached by expansion: constrain the hop to the bound node (equality by
                // identity) instead of rebinding it. Any label/property written on this reused occurrence is
                // applied as a filter after the join; no re-bind here.
                op = new ExpandInto(op, this.graph, names[i]!, names[i + 1]!, rel.RelType, rel.Direction, rel.Variable);
                op = this.foldReusedConstraints(op, toNode, names[i + 1]!);
                continue;
            }
            else
            {
                op = new Expand(op, this.graph, names[i]!, names[i + 1]!, rel.RelType, rel.Direction, toNode.Label, rel.Variable);
            }
            op = this.foldNodeProperties(op, toNode, names[i + 1]!);
            if (toNode.Variable !== undefined) bound.add(toNode.Variable);
        }
        return op;
    }

    private validateRels(path: PatternPath): void
    {
        for (const r of path.Rels)
        {
            if (r.Properties.size > 0)
            {
                throw new CypherSemanticError(LogicalPlanner.RelPropsUnsupported);
            }
            if (r.RelType !== undefined && !this.graph.HasRelationshipType(r.RelType))
            {
                throw new CypherSemanticError(`${LogicalPlanner.UnknownRelType} "${r.RelType}"`);
            }
        }
    }

    private buildProjection(input: IOperator, projection: ProjectionClause, implicitOrder: boolean): IOperator
    {
        const groupingItems: ReturnItem[] = [];
        const aggregateItems: AggregateItem[] = [];
        for (const item of projection.Items)
        {
            if (item.Expr.ContainsAggregate())
            {
                aggregateItems.push({ Column: item.ColumnName(), Call: this.aggregateCall(item) });
            }
            else
            {
                groupingItems.push(item);
            }
        }

        let op: IOperator = aggregateItems.length > 0
            ? new Aggregate(input, groupingItems, aggregateItems, this.parameters, this.cancel)
            : new Project(input, projection.Items, this.parameters);

        if (projection.Distinct) op = new Distinct(op, projection.Items.map((i) => i.ColumnName()), this.cancel);
        // HAVING-style: WITH ... WHERE filters the projected/aggregated rows, then ORDER BY/SKIP/LIMIT paginate the filtered set.
        if (projection.Where !== undefined) op = new Filter(op, this.resolveWithWhere(projection), this.parameters);
        if (projection.OrderBy !== undefined)
        {
            op = new Sort(op, this.resolveOrderBy(projection), this.parameters, this.cancel);
        }
        else if (implicitOrder)
        {
            op = new Sort(op, this.implicitOrder(projection), this.parameters, this.cancel);
        }
        if (projection.Skip !== undefined) op = new Skip(op, this.evalCount(projection.Skip));
        if (projection.Limit !== undefined) op = new Limit(op, this.evalCount(projection.Limit));
        return op;
    }

    // Projected expression StructuralKey -> output column name. First projected item wins for duplicate projections
    // (identical values). Shared by WITH ... WHERE and ORDER BY resolution so the two stay in lockstep.
    private projectedColumnsByKey(projection: ProjectionClause): Map<string, string>
    {
        const byKey = new Map<string, string>();
        for (const item of projection.Items)
        {
            const key = item.Expr.StructuralKey();
            if (!byKey.has(key)) byKey.set(key, item.ColumnName());
        }
        return byKey;
    }

    // WITH ... WHERE runs over the projected rows. Symmetric with ORDER BY: any predicate sub-expression structurally
    // equal to a projected expression (WITH a.name AS n WHERE a.name = 'x') is rewritten to read that output column.
    // Whatever remains must reference projected output columns by NAME/alias, else it is an unknown WHERE column.
    private resolveWithWhere(projection: ProjectionClause): Expression
    {
        const columns = new Set<string>(projection.Items.map((i) => i.ColumnName()));
        const byKey = this.projectedColumnsByKey(projection);
        const rewritten = projection.Where!.Predicate.Rewrite((e) =>
        {
            const column = byKey.get(e.StructuralKey());
            return column === undefined ? undefined : new VariableRef(column);
        });
        const referenced = new Set<string>();
        rewritten.CollectVariables(referenced);
        for (const v of referenced)
        {
            if (!columns.has(v)) throw new CypherSemanticError(`${LogicalPlanner.UnknownWhereColumn}: "${v}"`);
        }
        return rewritten;
    }

    // Sort runs over the projected rows. A sort expression structurally equal to ANY projected expression
    // (RETURN a.x + 1 ORDER BY a.x + 1) is rewritten to read that output column; any other sort expression may only
    // reference projected output columns, else it is an unknown ORDER BY column.
    private resolveOrderBy(projection: ProjectionClause, orderBy: readonly SortItem[] = projection.OrderBy!): SortItem[]
    {
        const columns = new Set<string>(projection.Items.map((i) => i.ColumnName()));
        const byKey = this.projectedColumnsByKey(projection);
        return orderBy.map((sort) =>
        {
            const matched = byKey.get(sort.Expr.StructuralKey());
            if (matched !== undefined) return new SortItem(new VariableRef(matched), sort.Descending);
            const referenced = new Set<string>();
            sort.Expr.CollectVariables(referenced);
            for (const v of referenced)
            {
                if (!columns.has(v)) throw new CypherSemanticError(`${LogicalPlanner.UnknownOrderByColumn}: "${v}"`);
            }
            return sort;
        });
    }

    // Implicit paging order: ORDER BY all projected columns, ascending, resolved exactly as explicit alias references.
    // Ordering on every projected column makes this a total order so ties can't reorder a page split; rows equal in
    // every column are indistinguishable on the wire.
    private implicitOrder(projection: ProjectionClause): SortItem[]
    {
        const order = projection.Items.map((item) => new SortItem(new VariableRef(item.ColumnName()), false));
        return this.resolveOrderBy(projection, order);
    }

    private aggregateCall(item: ReturnItem): FunctionCall
    {
        if (item.Expr instanceof FunctionCall) return item.Expr;
        throw new CypherSemanticError(LogicalPlanner.NestedAggregate);
    }

    private evalCount(expr: Expression): number
    {
        const value = expr.Evaluate(new EvalContext(new Binding(), this.parameters));
        if (value instanceof ScalarValue && typeof value.Value === "number") return value.Value;
        throw new CypherSemanticError(LogicalPlanner.NonNumericLimit);
    }

    private anchor(node: NodePattern, name: string): IOperator
    {
        return node.Label === undefined ? new AllNodesScan(this.graph, name) : new LabelScan(this.graph, name, node.Label);
    }

    private foldReusedConstraints(op: IOperator, node: NodePattern, name: string): IOperator
    {
        let result = op;
        if (node.Label !== undefined) result = new LabelFilter(result, this.graph, name, node.Label);
        return this.foldNodeProperties(result, node, name);
    }

    private foldNodeProperties(op: IOperator, node: NodePattern, name: string): IOperator
    {
        let result = op;
        for (const [key, value] of node.Properties)
        {
            result = new Filter(result, new Comparison(new PropertyAccess(name, key), ComparisonOp.Eq, new Literal(value)), this.parameters);
        }
        return result;
    }
}
