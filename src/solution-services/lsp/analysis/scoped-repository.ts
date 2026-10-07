import { Repository, ELEMENT_ID, type ConceptSchema, type FieldSchema, type RelationshipSchema } from "../../../compiler-services/model/model.js";
import { MetaKind } from "../../../compiler-services/model/kinds.js";
import type { Node, NodeId } from "../../../compiler-services/model/graph.js";
import type { SourceSpan } from "../../../compiler-services/diagnostics/span.js";

// A read-only VIEW over the shared whole-solution Repository that reproduces the
// membership a project-scoped `checkAgainst(bases, sources)` model would have. The
// shared graph composes EVERY open member into one Repository; a per-project editor
// request must only see its own nodes plus its declared bases' closure (+ prelude),
// exactly as the old per-request `AnalysisSnapshot.Build` did. Without this, a bare
// reference could resolve to a same-named node contributed by an unrelated member
// (most visibly when two members share a namespace), diverging from Build.
//
// It extends Repository so it IS one (feature code is untouched and keeps its
// `Repository`-typed `Model`), and overrides exactly the read methods the analysis
// providers call, delegating each to the inner whole-solution repository but gating
// the result so it matches a project-scoped compile:
//   - VisibleIds-gated (a node contributes only if in scope): `has`, `resolve`,
//     `isClass`, `allNodes`, `instancesOf`, `subtypesOf`, and — via the visible
//     supertype chain — `schemaOf` (its `extends`) and `effectiveSchema` (its merged
//     fields/relationships). An out-of-scope same-namespace supertype or field-type
//     therefore contributes nothing, exactly as Build (which leaves it unresolved).
//   - OwnIds-gated: `spanOf`. Build records a source span ONLY for the project's own
//     loaded sources — bases arrive as compiled documents with no spans — so navigation
//     into a base symbol must return null just as Build does.
// The method names mirror Repository's existing (camelCase) surface, so they
// deliberately do not follow the PascalCase convention.
//
// INVARIANT: any new Repository read reached by a provider must get a matching scoped
// override here — the base graph is empty, so an un-overridden read fails closed
// (returns nothing) and silently diverges from Build.
export class ScopedRepository extends Repository
{
    private readonly inner: Repository;
    private readonly visibleIds: ReadonlySet<string>;
    private readonly ownIds: ReadonlySet<string>;
    private static readonly MemberKeySeparator = "#";

    constructor(inner: Repository, visibleIds: ReadonlySet<string>, ownIds: ReadonlySet<string>)
    {
        super();
        this.inner = inner;
        this.visibleIds = visibleIds;
        this.ownIds = ownIds;
    }

    public override has(id: NodeId): boolean
    {
        return this.visibleIds.has(id) && this.inner.has(id);
    }

    public override resolve(id: NodeId): Node | undefined
    {
        return this.visibleIds.has(id) ? this.inner.resolve(id) : undefined;
    }

    public override isClass(id: NodeId): boolean
    {
        return this.visibleIds.has(id) && this.inner.isClass(id);
    }

    public override allNodes(): Node[]
    {
        return this.inner.allNodes().filter((n) => this.visibleIds.has(n.id));
    }

    public override instancesOf(concept: NodeId): NodeId[]
    {
        return this.inner.instancesOf(concept).filter((id) => this.visibleIds.has(id));
    }

    public override subtypesOf(concept: NodeId): NodeId[]
    {
        return this.inner.subtypesOf(concept).filter((id) => this.visibleIds.has(id));
    }

    public override schemaOf(concept: NodeId): ConceptSchema
    {
        const schema = this.inner.schemaOf(concept);
        if (schema.extends === null || this.visibleIds.has(schema.extends)) return schema;
        // The declared parent is out of scope. Reproduce a scoped Build, where that parent
        // was never resolved, so the concept is parent-less (and the virtual-root rule
        // roots a concept at Element). The concept's OWN fields/relationships still stand.
        return { ...schema, extends: this.ElementFallback(concept) };
    }

    public override effectiveSchema(concept: NodeId): ConceptSchema
    {
        // Mirror Repository.effectiveSchema's merge, but over the VISIBLE supertype chain:
        // a merge that followed an out-of-scope parent would pull in fields/relationships a
        // scoped Build never sees. `schemaOf` is the gated one, so each step is in scope.
        const fields = new Map<string, FieldSchema>();
        const relationships = new Map<string, RelationshipSchema>();
        for (const current of this.VisibleChain(concept))
        {
            const schema = this.schemaOf(current);
            for (const field of schema.fields) if (!fields.has(field.name)) fields.set(field.name, field);
            for (const relationship of schema.relationships) if (!relationships.has(relationship.name)) relationships.set(relationship.name, relationship);
        }
        return { concept, extends: this.schemaOf(concept).extends, fields: [...fields.values()], relationships: [...relationships.values()] };
    }

    // The concept plus its supertypes reachable through in-scope parents only, walked via
    // the GATED `schemaOf.extends` so an out-of-scope parent truncates the chain (then the
    // Element virtual-root takes over), exactly as a scoped Build's closure would.
    private VisibleChain(concept: NodeId): NodeId[]
    {
        const chain: NodeId[] = [concept];
        const seen = new Set<string>([concept]);
        let current = concept;
        for (;;)
        {
            const parent = this.schemaOf(current).extends;
            if (parent === null || seen.has(parent)) break;
            seen.add(parent);
            chain.push(parent);
            current = parent;
        }
        return chain;
    }

    // Build's virtual-root rule: a parent-less concept (and only a concept) roots at
    // Element when Element is in scope; anything else is genuinely parent-less (null).
    private ElementFallback(concept: NodeId): NodeId | null
    {
        const rootsAtElement = concept !== ELEMENT_ID
            && this.inner.resolve(concept)?.metaKind === MetaKind.Concept
            && this.has(ELEMENT_ID);
        return rootsAtElement ? ELEMENT_ID : null;
    }

    public override spanOf(key: string): SourceSpan | null
    {
        const nodeId = key.split(ScopedRepository.MemberKeySeparator)[0] ?? key;
        return this.ownIds.has(nodeId) ? this.inner.spanOf(key) : null;
    }
}
