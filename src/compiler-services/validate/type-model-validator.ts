/**
 * Type-model rule validation (spec R4, R5, R7, R11): no overriding, member-name
 * collisions are errors, aspects are not instance types, `derive` targets must be
 * aspect-contributed, and inheritance / aspect-inclusion graphs are acyclic with at
 * most one `Extends` edge per concept.
 *
 * `effectiveSchema` merges first-wins and therefore hides collisions, so this class
 * computes each member's declaring sources itself.
 */

import { Direction, EdgeKind, Tier, type Node, type NodeId } from "../model/graph.js";
import { MetaKind } from "../model/kinds.js";
import { ELEMENT_ID, MalformedDerivesError, Repository } from "../model/model.js";
import type { SourceSpan } from "../diagnostics/span.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

export class TypeModelValidator
{
  private static readonly RedeclaredMessage = "concept redeclares member";
  private static readonly CollisionMessage = "member is provided by more than one source";
  private static readonly NotInstantiableMessage = "is an aspect and cannot be instantiated";
  private static readonly DeriveTargetMessage = "derive target is not an aspect-contributed member of";
  private static readonly CycleMessage = "inheritance cycle";
  private static readonly MultipleExtendsMessage = "has more than one Extends edge";
  private static readonly DuplicateDeriveMessage = "is derived more than once on";
  private static readonly DerivedAssignedMessage = "is derived and cannot be assigned on";
  private static readonly Separator = " -> ";

  private readonly model: Repository;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly fullCache = new Map<NodeId, Map<string, Set<NodeId>>>();
  private readonly ownNamesCache = new Map<NodeId, Set<string>>();
  private readonly cycleMembers = new Set<NodeId>();

  constructor(model: Repository)
  {
    this.model = model;
  }

  public Validate(): Diagnostic[]
  {
    this.diagnostics.length = 0;
    this.fullCache.clear();
    this.ownNamesCache.clear();
    this.cycleMembers.clear();
    this.CheckCycles(EdgeKind.Extends, MetaKind.Concept);
    this.CheckCycles(EdgeKind.IncludesAspect, MetaKind.Aspect);
    for (const node of this.model.allNodes())
    {
      if (node.canonicalId != null) continue;
      if (node.tier === Tier.Ontology && node.metaKind === MetaKind.Concept) this.CheckConcept(node);
      else if (node.tier === Tier.Ontology && node.metaKind === MetaKind.Aspect) this.CheckAspect(node);
      else if (node.tier === Tier.Instance) this.CheckInstance(node);
    }
    return [...this.diagnostics];
  }

  // -- cycles and Extends arity ----------------------------------------------

  /** DFS over `kind` edges between nodes of `metaKind`; each cycle is reported once. */
  private CheckCycles(kind: EdgeKind, metaKind: MetaKind): void
  {
    const done = new Set<NodeId>();
    const reported = new Set<string>();
    for (const node of this.model.allNodes())
    {
      if (node.metaKind !== metaKind || node.canonicalId != null) continue;
      this.Walk(node.id, kind, metaKind, [], done, reported);
    }
  }

  private Walk(
    id: NodeId,
    kind: EdgeKind,
    metaKind: MetaKind,
    path: NodeId[],
    done: Set<NodeId>,
    reported: Set<string>,
  ): void
  {
    const at = path.indexOf(id);
    if (at >= 0)
    {
      this.ReportCycle(path.slice(at), reported);
      return;
    }
    if (done.has(id)) return;
    path.push(id);
    if (kind === EdgeKind.Extends)
    {
      const parents = this.model.related(id, EdgeKind.Extends, Direction.Out);
      if (parents.length > 1 && this.model.resolve(id)?.metaKind === MetaKind.Concept) this.ReportMultipleExtends(id, parents);
    }
    for (const next of this.model.related(id, kind, Direction.Out))
    {
      if (this.model.resolve(next)?.metaKind !== metaKind) continue;
      this.Walk(next, kind, metaKind, path, done, reported);
    }
    path.pop();
    done.add(id);
  }

  private ReportCycle(cycle: NodeId[], reported: Set<string>): void
  {
    const key = [...cycle].sort().join(TypeModelValidator.Separator);
    if (reported.has(key)) return;
    reported.add(key);
    for (const member of cycle) this.cycleMembers.add(member);
    const anchor = [...cycle].sort()[0]!;
    // Rotate so the route starts at the anchor: the message is independent of declaration order.
    const start = cycle.indexOf(anchor);
    const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
    const route = [...rotated, anchor].join(TypeModelValidator.Separator);
    this.diagnostics.push(this.Error(
      DiagnosticCode.InheritanceCycle, anchor, anchor,
      `${TypeModelValidator.CycleMessage}: ${route}`, this.model.spanOf(anchor)));
  }

  private ReportMultipleExtends(id: NodeId, parents: NodeId[]): void
  {
    this.diagnostics.push(this.Error(
      DiagnosticCode.MultipleExtendsEdges, id, id,
      `"${id}" ${TypeModelValidator.MultipleExtendsMessage}: ${parents.join(", ")}`, this.model.spanOf(id)));
  }

  // -- member rules ------------------------------------------------------------

  private CheckConcept(node: Node): void
  {
    const concept = node.id;
    if (this.cycleMembers.has(concept)) return;
    const own = this.OwnNames(concept);
    const others = this.ProvidedByOthers(concept);
    for (const name of own)
    {
      if (others.has(name)) this.ReportRedeclared(concept, name);
    }
    // slice(0, 1): with several Extends edges only the first is a base here; the extra
    // edges are already reported as MultipleExtendsEdges.
    const parent = this.model.related(concept, EdgeKind.Extends, Direction.Out).slice(0, 1);
    this.CheckCollisions(concept, [...parent, ...this.DirectIncludes(concept)], others);
    this.CheckDerives(concept);
  }

  private CheckAspect(node: Node): void
  {
    if (this.cycleMembers.has(node.id)) return;
    this.CheckCollisions(node.id, this.DirectIncludes(node.id), this.Full(node.id));
  }

  /** Names provided by more than one distinct source at `owner` (own members count as a source
   *  for aspects only; a concept's own member against a provider is a redeclaration instead).
   *  Skipped when a single direct base already collides on the name (reported there). */
  private CheckCollisions(owner: NodeId, bases: NodeId[], providers: Map<string, Set<NodeId>>): void
  {
    for (const [name, sources] of providers)
    {
      if (sources.size < 2) continue;
      // Already reported on a base only when one base accounts for every source here.
      if (bases.some((base) => this.IsSuperset(this.Full(base).get(name), sources))) continue;
      this.diagnostics.push(this.Error(
        DiagnosticCode.MemberCollision, owner, `${owner}.${name}`,
        `"${owner}.${name}" ${TypeModelValidator.CollisionMessage}: ${[...sources].join(", ")}`,
        this.MemberSpan(owner, name)));
    }
  }

  private IsSuperset(candidate: Set<NodeId> | undefined, sources: Set<NodeId>): boolean
  {
    if (candidate === undefined || candidate.size < 2) return false;
    for (const source of sources)
    {
      if (!candidate.has(source)) return false;
    }
    return true;
  }

  private CheckDerives(concept: NodeId): void
  {
    let derives: { member: string; expression: string }[];
    try
    {
      derives = this.model.DerivesOf(concept);
    }
    catch (error)
    {
      if (!(error instanceof MalformedDerivesError)) throw error;
      this.diagnostics.push(this.Error(
        DiagnosticCode.MalformedDerives, concept, concept, error.message, this.model.spanOf(concept)));
      return;
    }
    if (derives.length === 0) return;
    const seen = new Set<string>();
    for (const derive of derives)
    {
      if (seen.has(derive.member))
      {
        this.diagnostics.push(this.Error(
          DiagnosticCode.DuplicateDerive, concept, `${concept}.${derive.member}`,
          `"${derive.member}" ${TypeModelValidator.DuplicateDeriveMessage} "${concept}"`, this.model.spanOf(concept)));
        continue;
      }
      seen.add(derive.member);
      if (this.model.IsDerivableMember(concept, derive.member)) continue;
      this.diagnostics.push(this.Error(
        DiagnosticCode.DeriveTargetNotContributed, concept, `${concept}.${derive.member}`,
        `"${derive.member}": ${TypeModelValidator.DeriveTargetMessage} "${concept}"`,
        this.model.spanOf(Repository.deriveKey(concept, derive.member)) ?? this.model.spanOf(concept)));
    }
  }

  private CheckInstance(node: Node): void
  {
    if (node.type === null) return;
    if (this.model.resolve(node.type)?.metaKind !== MetaKind.Aspect)
    {
      this.CheckDerivedAssignments(node, node.type);
      return;
    }
    this.diagnostics.push(this.Error(
      DiagnosticCode.AspectNotInstantiable, node.id, node.type,
      `"${node.id}": "${node.type}" ${TypeModelValidator.NotInstantiableMessage}`, this.model.spanOf(node.id)));
  }

  /** A derived member (R7) is computed, never stored: an instance may not assign it. */
  private CheckDerivedAssignments(node: Node, type: NodeId): void
  {
    for (const name of this.model.DerivedMembersOf(type))
    {
      const assigned = node.attrs.has(name)
        || this.model.related(node.id, EdgeKind.Relationship, Direction.Out, name).length > 0;
      if (!assigned) continue;
      this.diagnostics.push(this.Error(
        DiagnosticCode.DerivedMemberAssigned, node.id, `${type}.${name}`,
        `"${name}" ${TypeModelValidator.DerivedAssignedMessage} "${node.id}"`,
        this.model.spanOf(Repository.memberKey(node.id, name)) ?? this.model.spanOf(node.id)));
    }
  }

  private ReportRedeclared(concept: NodeId, name: string): void
  {
    this.diagnostics.push(this.Error(
      DiagnosticCode.MemberRedeclared, concept, `${concept}.${name}`,
      `"${concept}" ${TypeModelValidator.RedeclaredMessage} "${name}"`, this.MemberSpan(concept, name)));
  }

  // -- source computation --------------------------------------------------------

  /** Names a type declares itself (fields and relationships). */
  private OwnNames(type: NodeId): Set<string>
  {
    let names = this.ownNamesCache.get(type);
    if (names === undefined)
    {
      const schema = this.model.schemaOf(type);
      names = new Set<string>([...schema.fields.map((f) => f.name), ...schema.relationships.map((r) => r.name)]);
      this.ownNamesCache.set(type, names);
    }
    return names;
  }

  /** Aspects a type includes directly. */
  private DirectIncludes(type: NodeId): NodeId[]
  {
    return this.model.related(type, EdgeKind.IncludesAspect, Direction.Out)
      .filter((a) => this.model.resolve(a)?.metaKind === MetaKind.Aspect);
  }

  /** Every type contributing to `type` besides itself: for a concept its supertypes (Element
   *  only when enforced) and carried aspects; for an aspect its include closure plus the root
   *  `Element` always — the flag only tolerates CONCEPT redeclarations of Element members, an
   *  aspect member that Element already provides would otherwise be silently shadowed. */
  private Contributors(type: NodeId): NodeId[]
  {
    const result = new Set<NodeId>();
    const isAspect = this.model.resolve(type)?.metaKind === MetaKind.Aspect;
    if (isAspect)
    {
      for (const a of this.model.closure(type, EdgeKind.IncludesAspect, Direction.Out, false)) result.add(a);
      if (this.model.resolve(ELEMENT_ID) !== undefined) result.add(ELEMENT_ID);
    }
    else
    {
      for (const s of this.model.supertypesOf(type)) result.add(s);
      for (const a of this.model.AspectsOf(type)) result.add(a);
    }
    result.delete(type);
    return [...result];
  }

  /** name -> distinct declaring types, across contributors only (not `type` itself). */
  private ProvidedByOthers(type: NodeId): Map<string, Set<NodeId>>
  {
    const map = new Map<string, Set<NodeId>>();
    for (const source of this.Contributors(type)) this.AddNames(map, source);
    return map;
  }

  /** name -> distinct declaring types, including `type`'s own members. Memoized. */
  private Full(type: NodeId): Map<string, Set<NodeId>>
  {
    let cached = this.fullCache.get(type);
    if (cached === undefined)
    {
      cached = this.ProvidedByOthers(type);
      this.AddNames(cached, type);
      this.fullCache.set(type, cached);
    }
    return cached;
  }

  private AddNames(map: Map<string, Set<NodeId>>, source: NodeId): void
  {
    for (const name of this.OwnNames(source))
    {
      let set = map.get(name);
      if (set === undefined)
      {
        set = new Set<NodeId>();
        map.set(name, set);
      }
      set.add(source);
    }
  }

  private MemberSpan(owner: NodeId, name: string): SourceSpan | null
  {
    return this.model.spanOf(Repository.memberKey(owner, name)) ?? this.model.spanOf(owner);
  }

  private Error(code: DiagnosticCode, node: NodeId, path: string, message: string, span: Diagnostic["span"]): Diagnostic
  {
    return { code, severity: Severity.Error, node, path, message, span };
  }
}
