import { FrozenRepository } from "../compiler-services/model/frozen.js";
import { MetaKind } from "../compiler-services/model/kinds.js";
import { Tier } from "../compiler-services/model/graph.js";
import { toElement, type Element, type ElementSchema } from "../compiler-services/model/element.js";
import type { TodlDocument, JsonEdge, JsonNode } from "../compiler-services/emit/json.js";
import type { ConceptSummary, EntitySummary } from "./dto.js";
import type { IGraphQuery } from "./graph-query.js";

// Read-only, browser-safe façade over a compiled TODL document. Every method is a thin
// projection over FrozenRepository — no query engine of its own — returning plain DTOs.
export class GraphApi implements IGraphQuery
{
    private static readonly LabelField = "label";
    private static readonly NameField = "name";

    private constructor(private readonly repo: FrozenRepository)
    {
    }

    public static FromDocument(document: TodlDocument): GraphApi
    {
        return new GraphApi(FrozenRepository.fromJSON(document));
    }

    // Merge several documents (deps-first order) into one queryable graph. Nodes union
    // by id (later wins), edges union by identity, so overlapping closures collapse.
    public static FromDocuments(documents: readonly TodlDocument[]): GraphApi
    {
        return GraphApi.FromDocument(GraphApi.Merge(documents));
    }

    private static Merge(documents: readonly TodlDocument[]): TodlDocument
    {
        const nodes = new Map<string, JsonNode>();
        const edges = new Map<string, JsonEdge>();
        for (const doc of documents)
        {
            for (const node of doc.nodes) nodes.set(node.id, node);
            for (const edge of doc.edges) edges.set(GraphApi.EdgeKey(edge), edge);
        }
        return { nodes: [...nodes.values()], edges: [...edges.values()] };
    }

    private static EdgeKey(edge: JsonEdge): string
    {
        return `${edge.from} ${edge.to} ${edge.kind} ${edge.via ?? ""}`;
    }

    public Concepts(): ConceptSummary[]
    {
        return this.repo.nodesOfMetaKind(MetaKind.Concept).map((id) => this.ConceptSummaryOf(id));
    }

    public InstancesOf(conceptId: string): EntitySummary[]
    {
        return this.repo.instancesOf(conceptId).map((id) => this.EntitySummaryOf(id));
    }

    public Entity(id: string, opts: { depth?: number } = {}): Element | undefined
    {
        const entity = this.repo.entity(id);
        if (entity === undefined) return undefined;
        return toElement(this.repo, entity, opts.depth !== undefined ? { maxDepth: opts.depth } : {});
    }

    public Refs(id: string, member: string): EntitySummary[]
    {
        return this.repo.refs(id, member).map((target) => this.EntitySummaryOf(target));
    }

    public Referrers(id: string, member?: string): EntitySummary[]
    {
        return this.repo.referrers(id, member).map((source) => this.EntitySummaryOf(source));
    }

    public Search(text: string): EntitySummary[]
    {
        const needle = text.toLowerCase();
        return this.repo.allNodes()
            .filter((node) => node.tier === Tier.Instance)
            .map((node) => this.EntitySummaryOf(node.id))
            .filter((summary) => summary.label.toLowerCase().includes(needle) || summary.id.toLowerCase().includes(needle));
    }

    public Narrower(termId: string): EntitySummary[]
    {
        return this.repo.narrowerOf(termId).map((id) => this.EntitySummaryOf(id));
    }

    public Broader(termId: string): EntitySummary[]
    {
        return this.repo.broaderOf(termId).map((id) => this.EntitySummaryOf(id));
    }

    public Descendants(termId: string): EntitySummary[]
    {
        return this.repo.descendantsOf(termId).map((id) => this.EntitySummaryOf(id));
    }

    public Ancestors(termId: string): EntitySummary[]
    {
        return this.repo.ancestorsOf(termId).map((id) => this.EntitySummaryOf(id));
    }

    public Schema(conceptId: string): ElementSchema | undefined
    {
        return this.Entity(conceptId, { depth: 0 })?.schema;
    }

    private ConceptSummaryOf(id: string): ConceptSummary
    {
        const node = this.repo.resolve(id);
        const label = String(this.repo.attr(id, GraphApi.LabelField) ?? node?.localId ?? id);
        return { id, label, namespace: node?.namespace ?? "" };
    }

    private EntitySummaryOf(id: string): EntitySummary
    {
        const node = this.repo.resolve(id);
        const label = String(this.repo.attr(id, GraphApi.LabelField) ?? this.repo.attr(id, GraphApi.NameField) ?? id);
        return { id, concept: node?.type ?? "", label };
    }
}
