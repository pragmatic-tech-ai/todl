import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";
import type { NodePattern, PatternPath } from "./patterns.js";
import type { CypherQueryModel, QueryPart, ProjectionClause, ReturnItem } from "./query-model.js";
import { MatchClause, UnwindClause } from "./query-model.js";
import { CypherSemanticError } from "./errors.js";
import { ComparisonOp } from "./enums.js";
import type { Expression } from "./expressions.js";
import { Comparison, PropertyAccess, Literal, FunctionCall } from "./expressions.js";
import { Binding, EvalContext } from "./binding.js";
import { ScalarValue } from "./values.js";
import { IOperator, AllNodesScan, LabelScan, Expand, Filter, Project, SingleRow, BindingRow } from "./operators.js";
import { Unwind } from "./operators-unwind.js";
import { CartesianProduct } from "./operators-join.js";
import { OptionalApply } from "./operators-optional.js";
import { Aggregate } from "./operators-aggregate.js";
import type { AggregateItem } from "./operators-aggregate.js";
import { Sort, Skip, Limit, Distinct } from "./operators-ordering.js";

export interface PlannerOptions
{
    readonly MaxVarLength?: number;
}

export class LogicalPlanner
{
    private static readonly AnonPrefix = "__n";
    private static readonly RelPropsUnsupported = "relationship properties are not supported";
    private static readonly UnknownRelType = "unknown relationship type";
    private static readonly UnboundVariable = "variable not in scope";
    private static readonly NonNumericLimit = "SKIP/LIMIT must evaluate to a number";
    private static readonly NestedAggregate = "aggregate functions must be a direct call in a projection item";
    private static readonly DefaultMaxVarLength = 15;

    private readonly maxVarLength: number;

    constructor(
        private readonly graph: ICypherGraph,
        private readonly parameters: ReadonlyMap<string, Scalar>,
        options?: PlannerOptions,
    )
    {
        // Variable-length wiring lands in a later task; the cap is accepted and carried now.
        this.maxVarLength = options?.MaxVarLength ?? LogicalPlanner.DefaultMaxVarLength;
    }

    public Plan(model: CypherQueryModel): IOperator
    {
        let inScope = new Set<string>();
        let op: IOperator | undefined = undefined;
        for (const part of model.Parts)
        {
            op = this.compilePart(part, op, inScope);
            if (!part.Projection.IsReturn)
            {
                inScope = new Set<string>(part.Projection.Items.map((i) => i.ColumnName()));
            }
        }
        // Parse/fluent invariants guarantee at least one part, so op is always assigned.
        return op!;
    }

    private compilePart(part: QueryPart, input: IOperator | undefined, inScope: ReadonlySet<string>): IOperator
    {
        const declared = new Set<string>(inScope);
        for (const clause of part.Reading)
        {
            if (clause instanceof MatchClause) for (const v of clause.DeclaredVariables()) declared.add(v);
            else if (clause instanceof UnwindClause) declared.add(clause.Variable);
        }
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
        }
        if (op === undefined) op = new SingleRow();
        return this.buildProjection(op, part.Projection);
    }

    private validateScope(part: QueryPart, available: ReadonlySet<string>): void
    {
        const referenced = new Set<string>();
        for (const clause of part.Reading)
        {
            if (clause instanceof MatchClause) clause.Where?.Predicate.CollectVariables(referenced);
            else if (clause instanceof UnwindClause) clause.Expr.CollectVariables(referenced);
        }
        for (const item of part.Projection.Items) item.Expr.CollectVariables(referenced);
        // ORDER BY / SKIP / LIMIT may refer to projection aliases, so they are not scope-checked here.
        for (const v of referenced)
        {
            if (!available.has(v)) throw new CypherSemanticError(`${LogicalPlanner.UnboundVariable}: "${v}"`);
        }
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
        const build = (row: Binding): IOperator => this.compileMatch(new BindingRow(row), inner, new Set<string>(outerBound));
        for (const v of optionalVars) bound.add(v);
        return new OptionalApply(source, build, optionalVars);
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
            op = input;
        }
        else
        {
            const scan = this.anchor(anchor, names[0]!);
            op = input === undefined ? scan : new CartesianProduct(input, scan);
            op = this.foldNodeProperties(op, anchor, names[0]!);
            if (anchor.Variable !== undefined) bound.add(anchor.Variable);
        }

        for (let i = 0; i < path.Rels.length; i++)
        {
            const rel = path.Rels[i]!;
            const toNode = path.Nodes[i + 1]!;
            op = new Expand(op, this.graph, names[i]!, names[i + 1]!, rel.RelType, rel.Direction, toNode.Label);
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

    private buildProjection(input: IOperator, projection: ProjectionClause): IOperator
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
            ? new Aggregate(input, groupingItems, aggregateItems, this.parameters)
            : new Project(input, projection.Items, this.parameters);

        if (projection.Distinct) op = new Distinct(op, projection.Items.map((i) => i.ColumnName()));
        if (projection.OrderBy !== undefined) op = new Sort(op, projection.OrderBy, this.parameters);
        if (projection.Skip !== undefined) op = new Skip(op, this.evalCount(projection.Skip));
        if (projection.Limit !== undefined) op = new Limit(op, this.evalCount(projection.Limit));
        return op;
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
