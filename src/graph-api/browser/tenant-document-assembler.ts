// Assembles the portable TodlDocument a remote app renders from: the build-time
// ontology (concepts, annotations, the model node) plus the live instances a
// tenant returned as cypher node cells. Declared structurally so the engine takes
// no dependency on the protocol package; the adapter that runs the query lives in
// the generated app code.

import type { JsonEdge, JsonNode, TodlDocument } from "../../compiler-services/emit/json.js";

export interface TenantFieldCell
{
    value: string | number | boolean | null;
}

export interface TenantNodeCell
{
    id: string;
    concept: string;
    class?: string;
    fields: { [name: string]: TenantFieldCell };
    refs: { [name: string]: string[] };
}

export class TenantDocumentAssembler
{
    private static readonly OntologyTier = "Ontology";
    private static readonly InstanceTier = "Instance";
    private static readonly ConceptKind = "concept";
    private static readonly ModelKind = "model";
    private static readonly ContainsEdge = "Contains";
    private static readonly RelationshipEdge = "Relationship";
    private static readonly NamespaceSeparator = ".";

    /** The build-time schema slice of a compiled document: every non-instance node, the model node, and the edges among them. */
    public static SchemaOf(full: TodlDocument): TodlDocument
    {
        const nodes = full.nodes.filter(n => n.tier === TenantDocumentAssembler.OntologyTier || n.metaKind === TenantDocumentAssembler.ModelKind);
        const ids = new Set(nodes.map(n => n.id));
        return { nodes, edges: full.edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
    }

    /** True when a cypher result cell is a node cell (has an id and a concept). */
    public static IsNodeCell(cell: unknown): cell is TenantNodeCell
    {
        if (typeof cell !== "object" || cell === null) return false;
        const c = cell as Partial<TenantNodeCell>;
        return typeof c.id === "string" && typeof c.concept === "string" && typeof c.fields === "object" && c.fields !== null;
    }

    public static Assemble(schema: TodlDocument, cells: readonly TenantNodeCell[]): TodlDocument
    {
        const nodes: JsonNode[] = [...schema.nodes];
        const edges: JsonEdge[] = [...schema.edges];
        const known = new Set(nodes.map(n => n.id));
        // The ids ADDED as live instances by this call — not schema-node collisions. Only these contribute
        // relationship edges, so a cell whose id collides with a schema node never wires instance refs onto
        // that ontology node.
        const added = new Set<string>();
        const concepts = nodes.filter(n => n.metaKind === TenantDocumentAssembler.ConceptKind);
        const model = nodes.find(n => n.metaKind === TenantDocumentAssembler.ModelKind);
        // SP0 limitation (tracked as a Project Feature): a live cell whose id collides with a schema
        // node, or whose concept is not in the embedded schema, is skipped silently; a ref whose target
        // is not a known node is dropped (not emitted) so a dangling edge never fails the whole load. Full
        // reconstruction (inline objects, classes, taxonomy terms, instance annotations) is deferred.
        for (const cell of cells)
        {
            if (known.has(cell.id)) continue;
            const concept = TenantDocumentAssembler.ResolveConcept(concepts, cell.concept);
            if (concept === undefined) continue;
            known.add(cell.id);
            added.add(cell.id);
            nodes.push(TenantDocumentAssembler.InstanceNode(cell, concept));
            if (model !== undefined) edges.push({ kind: TenantDocumentAssembler.ContainsEdge, via: null, from: model.id, to: cell.id });
        }
        for (const cell of cells)
        {
            if (!added.has(cell.id)) continue;
            for (const [via, targets] of Object.entries(cell.refs ?? {}))
            {
                for (const to of targets)
                {
                    if (known.has(to)) edges.push({ kind: TenantDocumentAssembler.RelationshipEdge, via, from: cell.id, to });
                }
            }
        }
        return { nodes, edges };
    }

    private static ResolveConcept(concepts: readonly JsonNode[], name: string): JsonNode | undefined
    {
        const suffix = TenantDocumentAssembler.NamespaceSeparator + name;
        return concepts.find(c => c.id === name) ?? concepts.find(c => c.id.endsWith(suffix));
    }

    private static InstanceNode(cell: TenantNodeCell, concept: JsonNode): JsonNode
    {
        const cut = cell.id.lastIndexOf(TenantDocumentAssembler.NamespaceSeparator);
        const attrs: JsonNode["attrs"] = {};
        for (const [name, field] of Object.entries(cell.fields))
        {
            if (field.value !== null) attrs[name] = field.value;
        }
        return {
            id: cell.id,
            tier: TenantDocumentAssembler.InstanceTier,
            type: concept.id,
            metaKind: null,
            namespace: cut < 0 ? concept.namespace : cell.id.slice(0, cut),
            localId: cut < 0 ? cell.id : cell.id.slice(cut + 1),
            isClass: false,
            class: null,
            storageId: null,
            canonicalId: null,
            fields: [],
            attrs,
        };
    }
}
