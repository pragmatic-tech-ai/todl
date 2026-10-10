import type { JsonEdge, JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import type { Scalar } from "../compiler-services/model/graph.js";
import type { ConnectorBinding, ExternalRecord } from "./connector-plan.js";

/** Maps external records onto TODL instance nodes and merges them into a base shard. */
export class PopulationBuilder
{
    private static readonly InstanceTier = "Instance";
    private static readonly IdSeparator = "#";
    private static readonly NamespaceSeparator = ".";

    private readonly nodes: JsonNode[];
    private readonly edges: JsonEdge[];

    public constructor(base: TodlDocument)
    {
        this.nodes = [...base.nodes];
        this.edges = [...base.edges];
    }

    /** Mints one instance node per record, keyed by the binding's id key. */
    public Add(binding: ConnectorBinding, records: readonly ExternalRecord[]): this
    {
        const inverse = new Map<string, string>();
        for (const [member, external] of Object.entries(binding.FieldMap))
        {
            inverse.set(external, member);
        }
        const split = binding.Concept.lastIndexOf(PopulationBuilder.NamespaceSeparator);
        const namespace = split < 0 ? null : binding.Concept.slice(0, split);
        const concept = split < 0 ? binding.Concept : binding.Concept.slice(split + 1);

        for (const record of records)
        {
            const idValue = record[binding.IdKey];
            if (idValue === undefined || idValue === null) continue;
            const storageId = String(idValue);
            const attrs: Record<string, Scalar> = {};
            for (const [external, value] of Object.entries(record))
            {
                const member = inverse.get(external);
                if (member === undefined || value === null || value === undefined) continue;
                attrs[member] = value;
            }
            const suffix = `${PopulationBuilder.IdSeparator}${storageId}`;
            this.nodes.push({
                id: `${binding.Concept}${suffix}`,
                tier: PopulationBuilder.InstanceTier,
                type: binding.Concept,
                metaKind: null,
                namespace,
                localId: `${concept}${suffix}`,
                isClass: false,
                class: null,
                storageId,
                canonicalId: null,
                fields: [],
                attrs,
            });
        }
        return this;
    }

    public Build(): TodlDocument
    {
        this.ResolveCrossPopulationReferences();
        return { nodes: [...this.nodes], edges: [...this.edges] };
    }

    /**
     * v1 stub: scalar attrs are left intact. Turning reference-member values that match
     * another population's storageId into edges is the spec's open question
     * "Reference-member mapping across populations".
     */
    private ResolveCrossPopulationReferences(): void
    {
    }
}
