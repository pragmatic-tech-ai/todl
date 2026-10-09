import type { Repository } from "../model/model.js";
import type { NodeId, Scalar } from "../model/graph.js";
import { Builder } from "../model/builder.js";
import { MetaKind } from "../model/kinds.js";

/** Collapses instances that share a declared identity-key value into one canonical
 * node, aliasing the duplicates. Deterministic and idempotent. */
export class ResolutionPass
{
    public constructor(private readonly model: Repository)
    {
    }

    public Resolve(): void
    {
        for (const identityId of this.model.nodesOfMetaKind(MetaKind.Identity))
        {
            const node = this.model.resolve(identityId);
            if (node === undefined) continue;
            const concept = node.attrs.get(Builder.IdentityConceptAttr);
            const key = node.attrs.get(Builder.IdentityKeyAttr);
            if (typeof concept !== "string" || typeof key !== "string") continue;
            this.ResolveConcept(concept, key);
        }
    }

    private ResolveConcept(concept: NodeId, key: string): void
    {
        const clusters = new Map<string, NodeId[]>();
        for (const instanceId of this.model.instancesOf(concept))
        {
            const value = this.KeyValue(instanceId, key);
            if (value === undefined) continue;
            const bucket = `${typeof value}:${String(value)}`;
            const members = clusters.get(bucket);
            if (members === undefined) clusters.set(bucket, [instanceId]);
            else members.push(instanceId);
        }

        for (const members of clusters.values())
        {
            if (members.length < 2) continue;
            const sorted = [...members].sort();
            const canonical = sorted[0]!;
            for (let i = 1; i < sorted.length; i++)
            {
                this.model.alias(sorted[i]!, canonical);
            }
        }
    }

    private KeyValue(instanceId: NodeId, key: string): Scalar | undefined
    {
        if (key === Builder.StorageIdKey)
        {
            const stored = this.model.resolve(instanceId)?.storageId;
            return stored ?? undefined;
        }
        return this.model.effectiveFields(instanceId).get(key);
    }
}
