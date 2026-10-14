import type { InstanceMirror } from "../manifest/reflection/reflection.js";
import type { ICypherGraph } from "./graph.js";
import type { IOperator } from "./operators.js";
import { Binding } from "./binding.js";
import { NodeValue } from "./values.js";
import { PathValue, RelValue } from "./values-structured.js";
import { RelDirection } from "./enums.js";

/**
 * Variable-length expand. Walks repeated single-hop graph.Expand calls, never repeating a
 * relationship step (fromId, type, toId) within one path (Cypher relationship-isomorphism),
 * which also guarantees termination on cyclic graphs.
 * Limitation: RelValue.Type is relType, or "" when untyped (Expand does not return member names).
 */
export class VarLengthExpand implements IOperator
{
    private static readonly StepSeparator = "\u0000";
    private static readonly UntypedRel = "";

    constructor(
        private readonly child: IOperator,
        private readonly graph: ICypherGraph,
        private readonly fromVar: string,
        private readonly toVar: string,
        private readonly relType: string | undefined,
        private readonly direction: RelDirection,
        private readonly min: number,
        private readonly max: number,
        private readonly toLabel: string | undefined,
        private readonly pathVar: string | undefined,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const from = row.Get(this.fromVar);
            if (!(from instanceof NodeValue)) continue;
            const mirrors = this.graph.Reflect(from.Id);
            yield* this.Walk(row, from, mirrors, [from], [], new Set<string>());
        }
    }

    private *Walk(row: Binding, current: NodeValue, currentMirror: InstanceMirror | undefined, nodes: NodeValue[], rels: RelValue[], used: Set<string>): Iterable<Binding>
    {
        const depth = rels.length;
        if (depth >= this.min && this.LabelOk(currentMirror))
        {
            let out = row.With(this.toVar, current);
            if (this.pathVar !== undefined)
            {
                out = out.With(this.pathVar, new PathValue([...nodes], [...rels]));
            }
            yield out;
        }
        if (depth >= this.max) return;

        const type = this.relType ?? VarLengthExpand.UntypedRel;
        for (const target of this.graph.Expand(current.Id, this.relType, this.direction))
        {
            const next = new NodeValue(target);
            const key = this.StepKey(current.Id, type, next.Id);
            if (used.has(key)) continue;
            used.add(key);
            nodes.push(next);
            rels.push(this.OrientedRel(current.Id, type, next.Id));
            yield* this.Walk(row, next, target, nodes, rels, used);
            rels.pop();
            nodes.pop();
            used.delete(key);
        }
    }

    // Undirected: canonicalize endpoints so A-B and B-A are the same physical edge within one path.
    private StepKey(currentId: string, type: string, nextId: string): string
    {
        const ends = this.direction === RelDirection.Undirected ? [currentId, nextId].sort() : [currentId, nextId];
        return [ends[0], type, ends[1]].join(VarLengthExpand.StepSeparator);
    }

    // Outgoing walks current->next; Incoming walks against the edge, so the real edge is next->current.
    // Undirected keeps traversal order (true undirected orientation needs edge-direction info Expand does not return; filed Feature).
    private OrientedRel(currentId: string, type: string, nextId: string): RelValue
    {
        return this.direction === RelDirection.Incoming ? new RelValue(nextId, type, currentId) : new RelValue(currentId, type, nextId);
    }

    private LabelOk(mirror: InstanceMirror | undefined): boolean
    {
        if (this.toLabel === undefined) return true;
        return mirror !== undefined && this.graph.IsInstanceOf(mirror, this.toLabel);
    }
}
