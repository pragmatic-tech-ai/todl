import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { ModelConnectorPlan } from "./connector-plan.js";
import { ModelShardExtractor } from "./model-shard-extractor.js";

/**
 * The bound concepts whose pulled records can never be merged with another record, so a pushed filter that drops a
 * record only drops a row and never strips attributes from a merged entity. Identity resolution folds records by key,
 * match or merge rules, across bindings and with hand-authored instances; a concept qualifies only when none of that can
 * reach it: no match/merge rules anywhere, every identity keyed on storageId, exactly one binding in its type family
 * (ancestors and descendants), and no hand-authored instance in that family.
 */
export class MergeFreeConcepts
{
    private static readonly IdentityKind = "identity";
    private static readonly MatchKind = "match";
    private static readonly MergeKind = "merge";
    private static readonly KeyAttr = "key";
    private static readonly StorageIdKey = "storageId";
    private static readonly ExtendsEdge = "Extends";

    public static Of(plan: ModelConnectorPlan, base: TodlDocument): ReadonlySet<string>
    {
        const free = new Set<string>();
        if (!MergeFreeConcepts.OnlyStorageIdentities(base)) return free;
        const parents = new Map<string, string[]>();
        const children = new Map<string, string[]>();
        for (const edge of base.edges)
        {
            if (edge.kind !== MergeFreeConcepts.ExtendsEdge) continue;
            const from = String(edge.from);
            const to = String(edge.to);
            parents.set(from, [...(parents.get(from) ?? []), to]);
            children.set(to, [...(children.get(to) ?? []), from]);
        }
        const instanceTypes = new Set(base.nodes.filter((n) => n.tier === ModelShardExtractor.InstanceTier && n.type !== null).map((n) => n.type!));
        for (const binding of plan.Bindings)
        {
            const family = new Set([...MergeFreeConcepts.Reach(binding.Concept, parents), ...MergeFreeConcepts.Reach(binding.Concept, children)]);
            const bound = plan.Bindings.filter((b) => family.has(b.Concept)).length;
            const authored = [...family].some((c) => instanceTypes.has(c));
            if (bound === 1 && !authored) free.add(binding.Concept);
        }
        return free;
    }

    private static OnlyStorageIdentities(base: TodlDocument): boolean
    {
        return base.nodes.every((n) =>
            n.metaKind !== MergeFreeConcepts.MatchKind && n.metaKind !== MergeFreeConcepts.MergeKind
            && (n.metaKind !== MergeFreeConcepts.IdentityKind || n.attrs[MergeFreeConcepts.KeyAttr] === MergeFreeConcepts.StorageIdKey));
    }

    // The concept plus everything reachable along `links` (its ancestors or its descendants).
    private static Reach(concept: string, links: ReadonlyMap<string, readonly string[]>): Set<string>
    {
        const seen = new Set<string>([concept]);
        const queue = [concept];
        while (queue.length > 0)
        {
            for (const next of links.get(queue.pop()!) ?? [])
            {
                if (!seen.has(next))
                {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        return seen;
    }
}
