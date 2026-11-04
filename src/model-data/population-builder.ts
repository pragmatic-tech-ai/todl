import type { JsonEdge, JsonNode, TodlDocument } from "../compiler-services/emit/json.js";
import { EdgeKind, Tier, type Scalar } from "../compiler-services/model/graph.js";
import type { ConnectorBinding, ExternalRecord, SourceRef } from "./connector-plan.js";

/** Maps external records onto TODL instance nodes and merges them into a base shard. */
export class PopulationBuilder
{
    private static readonly IdSeparator = "#";
    private static readonly NamespaceSeparator = ".";

    private readonly nodes: JsonNode[];
    private readonly edges: JsonEdge[];
    private readonly sources = new Map<string, SourceRef>();

    public constructor(base: TodlDocument)
    {
        this.nodes = [...base.nodes];
        this.edges = [...base.edges];
    }

    /** Mints one instance node per record, keyed by the binding's id key. */
    public Add(binding: ConnectorBinding, records: readonly ExternalRecord[]): this
    {
        // External field -> member; if two members map to the same field, the last mapping wins.
        const inverse = new Map<string, string>();
        for (const [member, external] of Object.entries(binding.FieldMap))
        {
            // The id member's value is carried by storageId, not stamped as an attr.
            if (external === binding.IdKey) continue;
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
            const sourceTag = `${binding.Connector}${PopulationBuilder.NamespaceSeparator}${binding.Source}`;
            const suffix = `${PopulationBuilder.IdSeparator}${sourceTag}${PopulationBuilder.IdSeparator}${storageId}`;
            const nodeId = `${binding.Concept}${suffix}`;
            this.nodes.push({
                id: nodeId,
                tier: Tier[Tier.Instance],
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
            this.sources.set(nodeId, { Connector: binding.Connector, Source: binding.Source });
        }
        return this;
    }

    /** Minted instance node id -> the datasource/source it was populated from. Drives source-provenance and write fan-out. */
    public Sources(): ReadonlyMap<string, SourceRef>
    {
        return this.sources;
    }

    public Build(): TodlDocument
    {
        this.ResolveCrossPopulationReferences();
        return { nodes: [...this.nodes], edges: [...this.edges] };
    }

    /**
     * Adds a Relationship edge for a populated record's reference-member value (a concept-typed field or a relationship,
     * declared on its concept or inherited) when it names exactly one instance of a target concept (or a subtype) by
     * storageId, so the member is traversable. The raw value is KEPT as the attr: identity / match rules over the member
     * still see it, write-back still sends the original typed value, and two aliases with different values still surface
     * as a merge conflict. A value matching no instance, or more than one, gets no edge (nothing is guessed).
     */
    private ResolveCrossPopulationReferences(): void
    {
        const schema = new ReferenceSchema(this.nodes, this.edges);
        const byStorage = new Map<string, JsonNode[]>();
        for (const node of this.nodes)
        {
            if (node.tier !== Tier[Tier.Instance] || node.storageId === null || node.storageId === undefined) continue;
            const list = byStorage.get(node.storageId) ?? [];
            list.push(node);
            byStorage.set(node.storageId, list);
        }
        for (const node of this.nodes)
        {
            if (!this.sources.has(node.id) || node.type === null) continue;
            for (const [member, value] of Object.entries(node.attrs))
            {
                const targets = schema.TargetsOf(node.type, member);
                if (targets === undefined) continue;
                const matches = (byStorage.get(String(value)) ?? []).filter((n) => n.type !== null && schema.IsAnyOf(n.type, targets));
                if (matches.length !== 1) continue;
                this.edges.push({ kind: EdgeKind[EdgeKind.Relationship], via: member, from: node.id, to: matches[0]!.id });
            }
        }
    }
}

/** The reference members of the concepts in a document: concept-typed fields and relationships, with their targets. */
class ReferenceSchema
{
    private static readonly ConceptKind = "concept";
    private static readonly RelationshipKind = "relationship";
    private static readonly NameAttr = "name";

    private readonly concepts = new Set<string>();
    private readonly parents = new Map<string, string[]>();
    private readonly members = new Map<string, Map<string, Set<string>>>();

    constructor(nodes: readonly JsonNode[], edges: readonly JsonEdge[])
    {
        const relationshipName = new Map<string, string>();
        for (const node of nodes)
        {
            if (node.metaKind === ReferenceSchema.ConceptKind) this.concepts.add(node.id);
            if (node.metaKind === ReferenceSchema.RelationshipKind) relationshipName.set(node.id, String(node.attrs[ReferenceSchema.NameAttr]));
        }
        for (const node of nodes)
        {
            if (node.metaKind !== ReferenceSchema.ConceptKind) continue;
            for (const field of node.fields)
            {
                if (this.concepts.has(field.type)) this.Add(node.id, field.name, field.type);
            }
        }
        const owners = new Map<string, string>();
        for (const edge of edges)
        {
            if (edge.kind === EdgeKind[EdgeKind.Extends]) this.parents.set(String(edge.from), [...(this.parents.get(String(edge.from)) ?? []), String(edge.to)]);
            if (edge.kind === EdgeKind[EdgeKind.HasRelationship]) owners.set(String(edge.to), String(edge.from));
        }
        for (const edge of edges)
        {
            if (edge.kind !== EdgeKind[EdgeKind.Targets]) continue;
            const relationship = String(edge.from);
            const owner = owners.get(relationship);
            const name = relationshipName.get(relationship);
            if (owner !== undefined && name !== undefined) this.Add(owner, name, String(edge.to));
        }
    }

    /** The target concepts of `member` on `concept` (declared or inherited); undefined when it is not a reference member. */
    public TargetsOf(concept: string, member: string): ReadonlySet<string> | undefined
    {
        for (const c of this.Lineage(concept))
        {
            const targets = this.members.get(c)?.get(member);
            if (targets !== undefined) return targets;
        }
        return undefined;
    }

    /** True when `concept` is one of `targets` or a subtype of one. */
    public IsAnyOf(concept: string, targets: ReadonlySet<string>): boolean
    {
        return this.Lineage(concept).some((c) => targets.has(c));
    }

    private Lineage(concept: string): string[]
    {
        const out: string[] = [];
        const queue = [concept];
        while (queue.length > 0)
        {
            const next = queue.shift()!;
            if (out.includes(next)) continue;
            out.push(next);
            queue.push(...(this.parents.get(next) ?? []));
        }
        return out;
    }

    private Add(concept: string, member: string, target: string): void
    {
        const byMember = this.members.get(concept) ?? new Map<string, Set<string>>();
        const targets = byMember.get(member) ?? new Set<string>();
        targets.add(target);
        byMember.set(member, targets);
        this.members.set(concept, byMember);
    }
}
