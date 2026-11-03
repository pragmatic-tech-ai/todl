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
import { CancelProbe, type ICancellation } from "./execution-limits.js";
import { RelOrientation } from "./operators.js";
import type { IOptionalPlan } from "./operators-optional.js";

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
    public static readonly ReplaceNotMap = "SET n = requires a map";
    public static readonly ReplaceCreatedNode = "SET n = {map} cannot replace the properties of a node created earlier in the same query (intra-query read-your-writes is unsupported)";
    public static readonly NullEndpoint = "cannot create a relationship from a null node variable";
    public static readonly MergeNeedsNode = "MERGE requires a node pattern";
    public static readonly MergeBoundNotNode = "MERGE variable is bound to a non-node value";
    public static readonly MergeBoundNull = "MERGE variable is bound to null";
    public static readonly MergeBoundConstrained = "MERGE cannot add a label or properties to an already-bound variable";
    public static readonly MergePathVariable = "a path variable is not supported in MERGE";
    public static readonly BoundMark = "b";
    public static readonly NewMark = "n";

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

    // A node this query just created: a live mirror when the read graph overlays uncommitted writes (read-your-writes),
    // else an id-only reference whose fields are not readable until commit.
    public static Created(graph: ICypherGraph, id: string): CypherValue
    {
        const mirror = graph.Reflect(id);
        return mirror === undefined ? new NodeRefValue(id) : new NodeValue(mirror);
    }
}

// Drains its input completely before yielding a row. Placed around write clauses when the write overlay is active, so
// every read feeding a write finishes before the write starts (no Halloween re-reads of its own effects) and the write
// finishes before anything above reads the graph: openCypher's clause-at-a-time semantics (Neo4j's "Eager" operator).
export class EagerBarrier implements IOperator
{
    constructor(private readonly child: IOperator, private readonly cancel?: ICancellation)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        const buffered: Binding[] = [];
        const probe = new CancelProbe(this.cancel);
        probe.Begin();
        for (const row of this.child.Rows())
        {
            probe.Tick();
            buffered.push(row);
        }
        yield* buffered;
    }
}

// Writes a pattern for one row: reuses its bound nodes, creates the rest (label required), creates every relationship
// in its direction, and binds every node and relationship variable. Shared by CREATE (always writes) and MERGE (writes
// when the pattern does not match).
class PathCreator
{
    constructor(private readonly graph: ICypherGraph, private readonly writer: ICypherWriter)
    {
    }

    // Fail fast, before any write: every created relationship needs a type and a direction, and cannot be variable-length.
    public static ValidateRels(path: PatternPath): void
    {
        for (const rel of path.Rels)
        {
            if (rel.IsVariableLength) throw new CypherSemanticError(WriteSupport.VarLengthCreate);
            if (rel.RelType === undefined) throw new CypherSemanticError(WriteSupport.RelTypeRequired);
            if (rel.Direction === RelDirection.Undirected) throw new CypherSemanticError(WriteSupport.RelDirectionRequired);
        }
    }

    public Create(row: Binding, path: PatternPath): Binding
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
            if (node.Variable !== undefined) current = current.With(node.Variable, WriteSupport.Created(this.graph, id));
        }
        for (let i = 0; i < path.Rels.length; i++)
        {
            const rel = path.Rels[i]!;
            const left = ids[i]!;
            const right = ids[i + 1]!;
            if (rel.Direction === RelDirection.Outgoing) this.writer.CreateRelationship(left, rel.RelType!, right);
            else this.writer.CreateRelationship(right, rel.RelType!, left);
            if (rel.Variable !== undefined) current = current.With(rel.Variable, RelOrientation.Oriented(rel.Direction, rel.RelType, left, right));
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

export class CreateOperator implements IOperator
{
    private readonly creator: PathCreator;

    constructor(
        private readonly child: IOperator,
        private readonly clause: CreateClause,
        graph: ICypherGraph,
        writer: ICypherWriter,
    )
    {
        for (const path of clause.Paths) PathCreator.ValidateRels(path);
        this.creator = new PathCreator(graph, writer);
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            let current = row;
            for (const path of this.clause.Paths) current = this.creator.Create(current, path);
            yield current;
        }
    }
}

// MERGE: match the whole pattern (bound variables fixed), yielding every match with ON MATCH applied; when nothing
// matches, write the whole pattern (every unbound node and every relationship) and apply ON CREATE. Matching runs the
// pattern through the read planner, so under the read-your-writes overlay a later row sees what an earlier row merged.
export class MergeOperator implements IOperator
{
    // Patterns this query wrote, keyed by bound ids + created-node identities. Only consulted when the read graph cannot
    // see this query's own writes (no overlay), so a repeated row reuses its earlier write instead of duplicating it.
    private readonly pending = new Map<string, readonly (readonly [string, CypherValue])[]>();
    private readonly creator: PathCreator;

    constructor(
        private readonly child: IOperator,
        private readonly clause: MergeClause,
        private readonly graph: ICypherGraph,
        writer: ICypherWriter,
        private readonly applier: SetApplier,
        // The MERGE pattern compiled as a match over one input row (its bound variables fixed).
        private readonly matcher: IOptionalPlan,
        bound: ReadonlySet<string>,
    )
    {
        MergeOperator.Validate(clause.Pattern, bound);
        this.creator = new PathCreator(graph, writer);
    }

    // Everything that would make the write invalid is rejected before the first row writes anything.
    private static Validate(pattern: PatternPath, bound: ReadonlySet<string>): void
    {
        if (pattern.Nodes.length === 0) throw new CypherSemanticError(WriteSupport.MergeNeedsNode);
        if (pattern.PathVariable !== undefined) throw new CypherSemanticError(WriteSupport.MergePathVariable);
        PathCreator.ValidateRels(pattern);
        for (const node of pattern.Nodes)
        {
            if (node.Variable !== undefined && bound.has(node.Variable))
            {
                if (node.Label !== undefined || node.Properties.size > 0)
                {
                    throw new CypherSemanticError(`${WriteSupport.MergeBoundConstrained}: "${node.Variable}"`);
                }
            }
            else if (node.Label === undefined)
            {
                throw new CypherSemanticError(WriteSupport.LabelRequired);
            }
        }
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            this.checkBound(row);
            const matches = [...this.matcher.Build(row).Rows()];
            if (matches.length > 0)
            {
                for (const match of matches)
                {
                    this.applyActions(match, this.clause.OnMatch);
                    yield match;
                }
                continue;
            }
            const key = this.key(row);
            const known = this.pending.get(key);
            if (known !== undefined)
            {
                let merged = row;
                for (const [name, value] of known) merged = merged.With(name, value);
                this.applyActions(merged, this.clause.OnMatch);
                yield merged;
                continue;
            }
            const created = this.creator.Create(row, this.clause.Pattern);
            this.pending.set(key, this.newBindings(row, created));
            this.applyActions(created, this.clause.OnCreate);
            yield created;
        }
    }

    private checkBound(row: Binding): void
    {
        for (const node of this.clause.Pattern.Nodes)
        {
            const value = node.Variable === undefined ? undefined : row.Get(node.Variable);
            if (value === undefined) continue;
            if (value instanceof NullValue) throw new CypherSemanticError(`${WriteSupport.MergeBoundNull}: "${node.Variable}"`);
            if (!(value instanceof NodeValue || value instanceof NodeRefValue))
            {
                throw new CypherSemanticError(`${WriteSupport.MergeBoundNotNode}: "${node.Variable}"`);
            }
        }
    }

    private applyActions(row: Binding, items: readonly SetItem[]): void
    {
        for (const item of items) this.applier.Apply(row, item);
    }

    // Identity of what this row would write: bound endpoints by id, created nodes by concept + sorted properties, and
    // every relationship's type and direction.
    private key(row: Binding): string
    {
        const nodes = this.clause.Pattern.Nodes.map((node) =>
        {
            const value = node.Variable === undefined ? undefined : row.Get(node.Variable);
            if (value !== undefined) return [WriteSupport.BoundMark, WriteSupport.NodeId(value) ?? null];
            const props = [...node.Properties].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return [WriteSupport.NewMark, this.graph.ResolveConcept(node.Label!), props];
        });
        const rels = this.clause.Pattern.Rels.map((rel) => [rel.RelType ?? null, rel.Direction]);
        return JSON.stringify([nodes, rels]);
    }

    private newBindings(before: Binding, after: Binding): (readonly [string, CypherValue])[]
    {
        const out: (readonly [string, CypherValue])[] = [];
        const names = [
            ...this.clause.Pattern.Nodes.map((n) => n.Variable),
            ...this.clause.Pattern.Rels.map((r) => r.Variable),
        ];
        for (const name of names)
        {
            if (name === undefined || before.Get(name) !== undefined) continue;
            const value = after.Get(name);
            if (value !== undefined) out.push([name, value]);
        }
        return out;
    }
}

// Applies SET items (SET n.p = v / n += {map} / n = {map}) to the bound node. Shared by SET and by MERGE's ON CREATE /
// ON MATCH actions so both write identically and share one query's relationship bookkeeping.
export class SetApplier
{
    constructor(
        private readonly graph: ICypherGraph,
        private readonly writer: ICypherWriter,
        private readonly parameters: ReadonlyMap<string, CypherValue>,
        // Edges created per (node, member), shared across every applier of one query so a later row or clause replacing
        // the same member removes them too.
        private readonly created: Map<string, Set<string>> = new Map<string, Set<string>>(),
    )
    {
    }

    public Apply(row: Binding, item: SetItem): void
    {
        const id = WriteSupport.RequiredNodeId(row, item.Variable);
        if (id === undefined) return;
        const value = WriteSupport.Eval(item.Value, row, this.parameters);
        if (item.Mode === SetMode.Property && item.Property !== undefined)
        {
            this.assign(id, item.Property, value);
            return;
        }
        if (value instanceof NullValue) return;
        if (!(value instanceof MapValue))
        {
            throw new CypherSemanticError(item.Mode === SetMode.Replace ? WriteSupport.ReplaceNotMap : WriteSupport.MergeMapNotMap);
        }
        if (item.Mode === SetMode.Replace) this.removeUnlisted(id, value);
        for (const [name, entry] of value.Entries) this.assign(id, name, entry);
    }

    // SET n = {map}: every own property not in the map is removed (relationships are untouched, as in openCypher where
    // properties and relationships are separate). Needs the node's current properties, so a node created earlier in
    // this query (no committed fields to read yet) is rejected like any other intra-query read of a created node.
    private removeUnlisted(id: string, map: MapValue): void
    {
        const mirror = this.graph.Reflect(id);
        if (mirror === undefined) throw new CypherSemanticError(WriteSupport.ReplaceCreatedNode);
        for (const name of Object.keys(mirror.node.attrs ?? {}))
        {
            if (!map.Entries.has(name)) this.writer.RemoveProperty(id, name);
        }
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

export class SetOperator implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly clause: SetClause,
        private readonly applier: SetApplier,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            for (const item of this.clause.Items) this.applier.Apply(row, item);
            yield row;
        }
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
