import { Builder } from '../model/builder.js';
import { Direction, EdgeKind } from '../model/graph.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import type { IEdgeConcept } from './package-security.js';

/**
 * The one detection of a reified edge concept: a concept a reified `operator` targets (an `EdgeKind.Targets` edge from
 * a `MetaKind.Operator` node that carries a `from` attr). Edge concepts carry no privileges and are never owned.
 */
export class ReifiedOperators
{
    private constructor()
    {
    }

    /** Every concept targeted (EdgeKind.Targets) by a MetaKind.Operator node that has a `from` attr, with that node's `from`/`to` attrs; sorted by Concept. */
    public static Of(model: Repository): readonly IEdgeConcept[]
    {
        const seen = new Set<string>();
        const edges: IEdgeConcept[] = [];
        for (const node of model.allNodes())
        {
            const edge = ReifiedOperators.EdgeOf(model, node.id);
            if (edge === undefined)
            {
                continue;
            }
            const key = JSON.stringify([edge.Concept, edge.From, edge.To]);
            if (!seen.has(key))
            {
                seen.add(key);
                edges.push(edge);
            }
        }
        return edges.sort((a, b) => ReifiedOperators.Compare(a.Concept, b.Concept)
            || ReifiedOperators.Compare(a.From, b.From)
            || ReifiedOperators.Compare(a.To, b.To));
    }

    /** True when some reified operator targets `concept`. */
    public static IsEdgeConcept(model: Repository, concept: string): boolean
    {
        return ReifiedOperators.Targeting(model, concept).length > 0;
    }

    /** The reified operators (glyph ids, sorted) that target `concept`. */
    public static Targeting(model: Repository, concept: string): readonly string[]
    {
        return model.related(concept, EdgeKind.Targets, Direction.In)
            .filter((glyph) => ReifiedOperators.EdgeOf(model, glyph)?.Concept === concept)
            .sort(ReifiedOperators.Compare);
    }

    /** The edge concept the reified operator `glyph` binds, or undefined when `glyph` is not a reified operator. */
    public static EdgeOf(model: Repository, glyph: string): IEdgeConcept | undefined
    {
        const node = model.resolve(glyph);
        if (node?.metaKind !== MetaKind.Operator || !node.attrs.has(Builder.OperatorFromAttr))
        {
            return undefined;
        }
        const concept = model.related(glyph, EdgeKind.Targets, Direction.Out)[0];
        if (concept === undefined)
        {
            return undefined;
        }
        return { Concept: concept, From: String(node.attrs.get(Builder.OperatorFromAttr)), To: String(node.attrs.get(Builder.OperatorToAttr) ?? '') };
    }

    private static Compare(a: string, b: string): number
    {
        return a < b ? -1 : a > b ? 1 : 0;
    }
}
