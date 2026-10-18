import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";
import type { ICypherWriter } from "./writer.js";
import type { IOperator } from "./operators.js";
import type { Expression } from "./expressions.js";
import type { NodePattern, PatternPath } from "./patterns.js";
import type { CreateClause, MergeClause, SetClause, DeleteClause, RemoveClause, SetItem } from "./query-model.js";
import { SetMode, RelDirection } from "./enums.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue, NodeValue, NodeRefValue, ScalarValue, NullValue } from "./values.js";
import { MapValue } from "./values-structured.js";
import { CypherSemanticError } from "./errors.js";

// Shared helpers for the write operators (no module-level free functions).
class WriteSupport
{
    public static readonly NotANode = "write target is not a node";
    public static readonly UnboundVariable = "variable not bound";
    public static readonly LabelRequired = "a created node requires a label";
    public static readonly RelTypeRequired = "a created relationship requires a type";
    public static readonly RelDirectionRequired = "a created relationship requires a direction";
    public static readonly VarLengthCreate = "variable-length relationships cannot be created";
    public static readonly NotAScalar = "property value must be a scalar, null, or a node";
    public static readonly MergeMapNotMap = "SET n += requires a map";
    public static readonly NullEndpoint = "cannot create a relationship from a null node variable";
    public static readonly MergeNeedsNode = "MERGE requires a node pattern";
    public static readonly MergeBoundNotNode = "MERGE variable is bound to a non-node value";
    public static readonly MergeBoundNull = "MERGE variable is bound to null";

    public static NodeId(value: CypherValue | undefined): string | undefined
    {
        if (value === undefined || value instanceof NullValue) return undefined;
        if (value instanceof NodeValue || value instanceof NodeRefValue) return value.Id;
        throw new CypherSemanticError(WriteSupport.NotANode);
    }

    public static RequiredNodeId(row: Binding, variable: string): string | undefined
    {
        const value = row.Get(variable);
        if (value === undefined) throw new CypherSemanticError(`${WriteSupport.UnboundVariable}: "${variable}"`);
        return WriteSupport.NodeId(value);
    }

    public static Eval(expr: Expression, row: Binding, parameters: ReadonlyMap<string, CypherValue>): CypherValue
    {
        return expr.Evaluate(new EvalContext(row, parameters));
    }
}

export class CreateOperator implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly clause: CreateClause,
        private readonly graph: ICypherGraph,
        private readonly writer: ICypherWriter,
    )
    {
        for (const path of clause.Paths) CreateOperator.ValidateRels(path);
    }

    // Fail fast, before any write: every created relationship needs a type and a direction, and cannot be variable-length.
    private static ValidateRels(path: PatternPath): void
    {
        for (const rel of path.Rels)
        {
            if (rel.IsVariableLength) throw new CypherSemanticError(WriteSupport.VarLengthCreate);
            if (rel.RelType === undefined) throw new CypherSemanticError(WriteSupport.RelTypeRequired);
            if (rel.Direction === RelDirection.Undirected) throw new CypherSemanticError(WriteSupport.RelDirectionRequired);
        }
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            let current = row;
            for (const path of this.clause.Paths) current = this.createPath(current, path);
            yield current;
        }
    }

    private createPath(row: Binding, path: PatternPath): Binding
    {
        let current = row;
        const ids: string[] = [];
        for (const node of path.Nodes)
        {
            const existing = node.Variable === undefined ? undefined : current.Get(node.Variable);
            if (existing instanceof NullValue) throw new CypherSemanticError(`${WriteSupport.NullEndpoint}: "${node.Variable}"`);
            const existingId = WriteSupport.NodeId(existing);
            if (existingId !== undefined)
            {
                ids.push(existingId);
                continue;
            }
            const id = this.createNode(node);
            ids.push(id);
            if (node.Variable !== undefined) current = current.With(node.Variable, new NodeRefValue(id));
        }
        for (let i = 0; i < path.Rels.length; i++)
        {
            const rel = path.Rels[i]!;
            const left = ids[i]!;
            const right = ids[i + 1]!;
            if (rel.Direction === RelDirection.Outgoing) this.writer.CreateRelationship(left, rel.RelType!, right);
            else this.writer.CreateRelationship(right, rel.RelType!, left);
        }
        return current;
    }

    private createNode(node: NodePattern): string
    {
        if (node.Label === undefined) throw new CypherSemanticError(WriteSupport.LabelRequired);
        const concept = this.graph.ResolveConcept(node.Label);
        return this.writer.CreateNode(concept, node.Properties);
    }
}

export class MergeOperator implements IOperator
{
    // Nodes this operator already created, keyed by concept + sorted props, so repeated rows create once.
    private readonly pending = new Map<string, string>();

    constructor(
        private readonly child: IOperator,
        private readonly clause: MergeClause,
        private readonly graph: ICypherGraph,
        private readonly writer: ICypherWriter,
    )
    {
        if (clause.Pattern.Nodes.length === 0) throw new CypherSemanticError(WriteSupport.MergeNeedsNode);
    }

    public *Rows(): Iterable<Binding>
    {
        const node = this.clause.Pattern.Nodes[0]!;
        for (const row of this.child.Rows())
        {
            // An already-bound variable keeps its node: no re-match, no create.
            const bound = node.Variable === undefined ? undefined : row.Get(node.Variable);
            if (bound instanceof NullValue) throw new CypherSemanticError(`${WriteSupport.MergeBoundNull}: "${node.Variable}"`);
            if (bound !== undefined)
            {
                if (!(bound instanceof NodeValue || bound instanceof NodeRefValue))
                {
                    throw new CypherSemanticError(`${WriteSupport.MergeBoundNotNode}: "${node.Variable}"`);
                }
                yield row;
                continue;
            }
            if (node.Label === undefined) throw new CypherSemanticError(WriteSupport.LabelRequired);
            const concept = this.graph.ResolveConcept(node.Label);
            const key = MergeOperator.Key(concept, node.Properties);
            const value = this.findOrCreate(concept, key, node);
            yield node.Variable === undefined ? row : row.With(node.Variable, value);
        }
    }

    private findOrCreate(concept: string, key: string, node: NodePattern): CypherValue
    {
        const matches = this.graph.NodesByLabel(concept)
            .filter((m) => [...node.Properties].every(([k, v]) => m.field(k)?.value === v))
            .sort((a, b) => (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
        if (matches.length > 0) return new NodeValue(matches[0]!);
        const known = this.pending.get(key);
        if (known !== undefined) return new NodeRefValue(known);
        const id = this.writer.CreateNode(concept, node.Properties);
        this.pending.set(key, id);
        return new NodeRefValue(id);
    }

    private static Key(concept: string, props: ReadonlyMap<string, Scalar>): string
    {
        const sorted = [...props].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return JSON.stringify([concept, sorted]);
    }
}

export class SetOperator implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly clause: SetClause,
        private readonly graph: ICypherGraph,
        private readonly writer: ICypherWriter,
        private readonly parameters: ReadonlyMap<string, CypherValue>,
        // Edges created per (node, member), shared across all SetOperators of one query so a later row or clause replacing the same member removes them too.
        private readonly created: Map<string, Set<string>> = new Map<string, Set<string>>(),
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            for (const item of this.clause.Items) this.apply(row, item);
            yield row;
        }
    }

    private apply(row: Binding, item: SetItem): void
    {
        const id = WriteSupport.RequiredNodeId(row, item.Variable);
        if (id === undefined) return;
        const value = WriteSupport.Eval(item.Value, row, this.parameters);
        if (item.Mode === SetMode.MergeMap || item.Property === undefined)
        {
            if (value instanceof NullValue) return;
            if (!(value instanceof MapValue)) throw new CypherSemanticError(WriteSupport.MergeMapNotMap);
            for (const [name, entry] of value.Entries) this.assign(id, name, entry);
            return;
        }
        this.assign(id, item.Property, value);
    }

    private assign(id: string, name: string, value: CypherValue): void
    {
        if (value instanceof NullValue)
        {
            this.writer.RemoveProperty(id, name);
        }
        else if (value instanceof NodeValue || value instanceof NodeRefValue)
        {
            this.replaceRef(id, name, value.Id);
        }
        else if (value instanceof ScalarValue)
        {
            this.writer.SetProperty(id, name, value.Value);
        }
        else
        {
            throw new CypherSemanticError(WriteSupport.NotAScalar);
        }
    }

    private replaceRef(id: string, member: string, targetId: string): void
    {
        const stale = new Set<string>();
        // A node created in this query has no visible pre-query edges; nothing to read from the graph.
        if (this.graph.Reflect(id) !== undefined)
        {
            for (const existing of this.graph.Expand(id, member, RelDirection.Outgoing)) stale.add(existing.node.id);
        }
        const key = JSON.stringify([id, member]);
        for (const prior of this.created.get(key) ?? []) stale.add(prior);
        for (const old of stale) this.writer.DeleteRelationship(id, member, old);
        this.writer.CreateRelationship(id, member, targetId);
        this.created.set(key, new Set<string>([targetId]));
    }
}

export class DeleteOperator implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly clause: DeleteClause,
        private readonly writer: ICypherWriter,
        private readonly parameters: ReadonlyMap<string, CypherValue>,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            for (const target of this.clause.Targets)
            {
                const id = WriteSupport.NodeId(WriteSupport.Eval(target, row, this.parameters));
                if (id !== undefined) this.writer.DeleteNode(id, this.clause.Detach);
            }
            yield row;
        }
    }
}

export class RemoveOperator implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly clause: RemoveClause,
        private readonly writer: ICypherWriter,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            for (const item of this.clause.Items)
            {
                const id = WriteSupport.RequiredNodeId(row, item.Variable);
                if (id !== undefined) this.writer.RemoveProperty(id, item.Property);
            }
            yield row;
        }
    }
}
