// Runtime reader of the compile-time application-root marking (design §6). Reads
// the document, not runtime reflection: the single model that is the `from` of an
// `Annotated` edge to an `application` app node is the root. The compile-time pass
// guarantees at most one; this throws defensively on a malformed document.

import { MetaKind } from "../compiler-services/model/kinds.js";
import type { NodeId } from "../compiler-services/model/graph.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";

export class ApplicationRootResolver
{
    private static readonly AnnotationName = "application";
    private static readonly AnnotatedKind = "Annotated";
    private static readonly OntologyTier = "Ontology";
    private static readonly MultipleRootsMessage =
        "document has more than one application-marked model; expected exactly one";

    /** The id of the single application-rooted model, or undefined for a library document. */
    static Resolve(doc: TodlDocument): NodeId | undefined
    {
        const models = new Set<NodeId>();
        const appNodes = new Set<NodeId>();
        for (const n of doc.nodes)
        {
            if (n.metaKind === MetaKind.Model) models.add(n.id);
            else if (n.type === ApplicationRootResolver.AnnotationName && n.tier === ApplicationRootResolver.OntologyTier) appNodes.add(n.id);
        }
        const roots: NodeId[] = [];
        for (const e of doc.edges)
        {
            if (e.kind !== ApplicationRootResolver.AnnotatedKind) continue;
            if (models.has(e.from) && appNodes.has(e.to)) roots.push(e.from);
        }
        if (roots.length > 1) throw new Error(ApplicationRootResolver.MultipleRootsMessage);
        return roots[0];
    }
}
