import type { Repository } from "../model/model.js";
import type { NodeId, Scalar } from "../model/graph.js";
import { Builder } from "../model/builder.js";
import { MetaKind } from "../model/kinds.js";
import { DisjointSet } from "./union-find.js";

/** Collapses instances that are the same entity — by declared identity key value
 * and/or declarative match rules, clustered transitively — into one canonical node
 * (the lexicographically smallest NodeId), aliasing the rest. Deterministic and idempotent. */
export class ResolutionPass
{
    private static readonly StorageKey = Builder.StorageIdKey;
    private static readonly TupleSeparator = "\u0000";

    public constructor(private readonly model: Repository)
    {
    }

    public Resolve(): void
    {
        const keyOf = new Map<NodeId, string>();
        const rulesOf = new Map<NodeId, string[][]>();

        for (const id of this.model.nodesOfMetaKind(MetaKind.Identity))
        {
            const node = this.model.resolve(id);
            const concept = node?.attrs.get(Builder.IdentityConceptAttr);
            const key = node?.attrs.get(Builder.IdentityKeyAttr);
            if (typeof concept === "string" && typeof key === "string") keyOf.set(concept, key);
        }
        for (const id of this.model.nodesOfMetaKind(MetaKind.Match))
        {
            const node = this.model.resolve(id);
            const concept = node?.attrs.get(Builder.MatchConceptAttr);
            const rulesRaw = node?.attrs.get(Builder.MatchRulesAttr);
            if (typeof concept !== "string" || typeof rulesRaw !== "string") continue;
            let rules: unknown;
            try { rules = JSON.parse(rulesRaw); }
            catch { continue; }
            if (!Array.isArray(rules)) continue;
            rulesOf.set(concept, rules as string[][]);
        }

        const concepts = new Set<NodeId>([...keyOf.keys(), ...rulesOf.keys()]);
        for (const concept of concepts)
        {
            this.ResolveConcept(concept, keyOf.get(concept), rulesOf.get(concept) ?? []);
        }
    }

    private ResolveConcept(concept: NodeId, key: string | undefined, rules: string[][]): void
    {
        const instances = this.model.instancesOf(concept);
        const ds = new DisjointSet<NodeId>();
        for (const id of instances) ds.Add(id);

        if (key !== undefined) this.UnionByFieldTuple(ds, instances, [key]);
        for (const rule of rules) this.UnionByFieldTuple(ds, instances, rule);

        for (const cluster of ds.Clusters())
        {
            if (cluster.length < 2) continue;
            const sorted = [...cluster].sort();
            const canonical = sorted[0]!;
            for (let i = 1; i < sorted.length; i++) this.model.alias(sorted[i]!, canonical);
        }
    }

    /** Union all instances that share the same defined value-tuple over `fields`.
     * Instances with any undefined field in the tuple are not grouped by this rule. */
    private UnionByFieldTuple(ds: DisjointSet<NodeId>, instances: readonly NodeId[], fields: readonly string[]): void
    {
        const buckets = new Map<string, NodeId>();
        for (const id of instances)
        {
            const values = fields.map((f) => this.FieldValue(id, f));
            if (values.some((v) => v === undefined)) continue;
            const signature = values.map((v) => `${typeof v}:${String(v)}`).join(ResolutionPass.TupleSeparator);
            const first = buckets.get(signature);
            if (first === undefined) buckets.set(signature, id);
            else ds.Union(first, id);
        }
    }

    private FieldValue(instanceId: NodeId, field: string): Scalar | undefined
    {
        if (field === ResolutionPass.StorageKey)
        {
            const stored = this.model.resolve(instanceId)?.storageId;
            return stored ?? undefined;
        }
        return this.model.effectiveFields(instanceId).get(field);
    }
}
