import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";
import type { NodePattern } from "./patterns.js";
import { CypherQueryModel } from "./query-model.js";
import { CypherSemanticError } from "./errors.js";
import { ComparisonOp } from "./enums.js";
import { Comparison, PropertyAccess, Literal } from "./expressions.js";
import { IOperator, AllNodesScan, LabelScan, Expand, Filter, Project } from "./operators.js";

export class LogicalPlanner
{
    private static readonly AnonPrefix = "__n";
    private static readonly SinglePathOnly = "SP1 supports a single pattern path";
    private static readonly RelPropsUnsupported = "relationship properties are not supported in SP1";
    private static readonly UnknownRelType = "unknown relationship type";
    private static readonly UnboundVariable = "variable not defined in MATCH";

    constructor(private readonly graph: ICypherGraph, private readonly parameters: ReadonlyMap<string, Scalar>)
    {
    }

    public Plan(model: CypherQueryModel): IOperator
    {
        this.validate(model);
        // validate() guarantees exactly one path; PatternPath invariant: Nodes.length === Rels.length + 1.
        const path = model.Match.Paths[0]!;
        const names = path.Nodes.map((n, i) => n.Variable ?? `${LogicalPlanner.AnonPrefix}${i}`);

        let op: IOperator = this.anchor(path.Nodes[0]!, names[0]!);
        op = this.foldNodeProperties(op, path.Nodes[0]!, names[0]!);

        for (let i = 0; i < path.Rels.length; i++)
        {
            const rel = path.Rels[i]!;
            const toNode = path.Nodes[i + 1]!;
            op = new Expand(op, this.graph, names[i]!, names[i + 1]!, rel.RelType, rel.Direction, toNode.Label);
            op = this.foldNodeProperties(op, toNode, names[i + 1]!);
        }

        if (model.Where !== undefined)
        {
            op = new Filter(op, model.Where.Predicate, this.parameters);
        }
        return new Project(op, model.Return.Items, this.parameters);
    }

    private validate(model: CypherQueryModel): void
    {
        if (model.Match.Paths.length !== 1)
        {
            throw new CypherSemanticError(LogicalPlanner.SinglePathOnly);
        }
        const path = model.Match.Paths[0]!;
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

        const declared = model.DeclaredVariables();
        const referenced = new Set<string>();
        model.Where?.Predicate.CollectVariables(referenced);
        for (const item of model.Return.Items)
        {
            item.Expr.CollectVariables(referenced);
        }
        for (const v of referenced)
        {
            if (!declared.has(v))
            {
                throw new CypherSemanticError(`${LogicalPlanner.UnboundVariable}: "${v}"`);
            }
        }
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
