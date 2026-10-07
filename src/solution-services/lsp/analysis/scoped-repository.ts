import { Repository, type ConceptSchema } from "../../../compiler-services/model/model.js";
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
// the result by `visibleIds`. `spanOf` is gated by `ownIds` instead: Build records a
// source span ONLY for the project's own loaded sources — bases arrive as compiled
// documents with no spans — so navigation into a base symbol must return null just as
// Build does. The method names mirror Repository's existing (camelCase) surface, so
// they deliberately do not follow the PascalCase convention.
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
        return this.inner.schemaOf(concept);
    }

    public override effectiveSchema(concept: NodeId): ConceptSchema
    {
        return this.inner.effectiveSchema(concept);
    }

    public override spanOf(key: string): SourceSpan | null
    {
        const nodeId = key.split(ScopedRepository.MemberKeySeparator)[0] ?? key;
        return this.ownIds.has(nodeId) ? this.inner.spanOf(key) : null;
    }
}
