import type { Element, ElementSchema } from "../compiler-services/model/element.js";
import type { ConceptSummary, EntitySummary } from "./dto.js";

// The read-only query contract, extracted from GraphApi so any backing (a single
// document, a composed DomainHost, later an HTTP proxy) can satisfy it.
export interface IGraphQuery
{
    Concepts(): ConceptSummary[];
    InstancesOf(conceptId: string): EntitySummary[];
    Entity(id: string, opts?: { depth?: number }): Element | undefined;
    Refs(id: string, member: string): EntitySummary[];
    Referrers(id: string, member?: string): EntitySummary[];
    Search(text: string): EntitySummary[];
    Narrower(termId: string): EntitySummary[];
    Broader(termId: string): EntitySummary[];
    Descendants(termId: string): EntitySummary[];
    Ancestors(termId: string): EntitySummary[];
    Schema(conceptId: string): ElementSchema | undefined;
}
