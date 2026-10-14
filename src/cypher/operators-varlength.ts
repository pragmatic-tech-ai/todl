import type { InstanceMirror } from "../manifest/reflection/reflection.js";
import type { ICypherGraph } from "./graph.js";
import type { IOperator } from "./operators.js";
import { RelOrientation } from "./operators.js";
import { Binding } from "./binding.js";
import { NodeValue } from "./values.js";
import { ListValue, PathValue, RelValue } from "./values-structured.js";
import { RelDirection } from "./enums.js";
import { CancelProbe } from "./execution-limits.js";
import type { ICancellation } from "./execution-limits.js";

/**
 * Variable-length expand. Walks repeated single-hop graph.Expand calls, never repeating a
 * relationship step (fromId, type, toId) within one path (Cypher relationship-isomorphism),
 * which also guarantees termination on cyclic graphs.
 * Limitation: RelValue.Type is relType, or "" when untyped (Expand does not return member names).
 */
export class VarLengthExpand implements IOperator
{
    private static readonly StepSeparator = "\u0000";

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
        private readonly relVar: string | undefined = undefined,
        private readonly cancel?: ICancellation,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        const probe = new CancelProbe(this.cancel);
        probe.Begin();
        for (const row of this.child.Rows())
        {
            probe.Tick();
            const from = row.Get(this.fromVar);
            if (!(from instanceof NodeValue)) continue;
            const mirrors = this.graph.Reflect(from.Id);
            yield* this.Walk(probe, row, from, mirrors, [from], [], new Set<string>());
        }
    }

    private *Walk(probe: CancelProbe, row: Binding, current: NodeValue, currentMirror: InstanceMirror | undefined, nodes: NodeValue[], rels: RelValue[], used: Set<string>): Iterable<Binding>
    {
        probe.Tick();
        const depth = rels.length;
        if (depth >= this.min && this.LabelOk(currentMirror))
        {
            let out = row.With(this.toVar, current);
            if (this.pathVar !== undefined)
            {
                out = out.With(this.pathVar, new PathValue([...nodes], [...rels]));
            }
            if (this.relVar !== undefined)
            {
                out = out.With(this.relVar, new ListValue([...rels]));
            }
            yield out;
        }
        if (depth >= this.max) return;

        const type = this.relType ?? RelOrientation.UntypedRel;
        for (const target of this.graph.Expand(current.Id, this.relType, this.direction))
        {
            const next = new NodeValue(target);
            const key = this.StepKey(current.Id, type, next.Id);
            if (used.has(key)) continue;
            used.add(key);
            nodes.push(next);
            rels.push(RelOrientation.Oriented(this.direction, this.relType, current.Id, next.Id));
            yield* this.Walk(probe, row, next, target, nodes, rels, used);
            rels.pop();
            nodes.pop();
            used.delete(key);
        }
    }

    // Undirected: canonicalize endpoints so A-B and B-A are the same physical edge within one path.
    // As with directed steps, parallel same-typed edges between the same two nodes collapse to one step.
    private StepKey(currentId: string, type: string, nextId: string): string
    {
        const ends = this.direction === RelDirection.Undirected ? [currentId, nextId].sort() : [currentId, nextId];
        return [ends[0], type, ends[1]].join(VarLengthExpand.StepSeparator);
    }

    private LabelOk(mirror: InstanceMirror | undefined): boolean
    {
        if (this.toLabel === undefined) return true;
        return mirror !== undefined && this.graph.IsInstanceOf(mirror, this.toLabel);
    }
}
