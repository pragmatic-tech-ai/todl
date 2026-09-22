import { FrozenRepository } from "../compiler-services/model/frozen.js";
import { MetaKind } from "../compiler-services/model/kinds.js";
import { Tier } from "../compiler-services/model/graph.js";
import { toElement, type Element, type ElementSchema } from "../compiler-services/model/element.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import type { ConceptSummary, EntitySummary } from "./dto.js";

// Read-only, browser-safe façade over a compiled TODL document. Every method is a thin
// projection over FrozenRepository — no query engine of its own — returning plain DTOs.
export class GraphApi
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
