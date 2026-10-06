/**
 * Model/annotation reflection for publishing — relocated from Plexus
 * (`library-bundle.ts` deriveClasses + `annotation-projection.ts`). Pure
 * traversal over a compiled `TodlDocument`; no I/O.
 */

import { MetaKind } from "../compiler-services/model/kinds.js";
import type { TodlDocument, JsonNode, JsonEdge } from "../compiler-services/emit/json.js";

const ANNOTATED = "Annotated";
const EXTENDS = "Extends";
const NAMESPACE_ATTR = "namespace";
// The prelude `icon` annotation's canonical id after the namespace-qualified-id flip.
// `projectAnnotations` keys the bag by the application's (qualified) annotation id, so
// the icon is read under this key, not a bare `icon`.
const ICON_ANNOTATION = "todl.icon";

/** One instantiable class a package provides — a palette item. */
export interface PublishedClass
{
  id: string; // qualified class NodeId, e.g. "Microsoft.Azure"
  concept: string; // node.typeOf — the meta concept it realises, e.g. "location"
  localId?: string; // attrs.id — the bare local name
  label?: string; // attrs.label, if present
  icon?: string; // annotation-derived icon path (bundle-relative)
}

/**
 * Projects node annotations from one compiled document, built once and reused
 * across many target nodes. The constructor indexes the model — the annotation
 * is-a chain (`Extends`), a node-by-id map, and `Annotated` edges grouped by
 * their source node — so each `Project` is O(the target's own annotations)
 * rather than a full O(nodes + edges) scan with a linear `nodes.find` per edge.
 *
 * Callers that project many targets against one closure (presentation baking's
 * per-entity icon index, `deriveClasses` over every class) MUST share a single
 * projector; constructing one per target reintroduces the quadratic cost this
 * class exists to remove. The free `projectAnnotations` below is the one-shot
 * convenience for a single target.
 */
export class AnnotationProjector
{
  // Direct `Extends` base of each annotation-declaration node, for the is-a walk.
  private readonly baseOf = new Map<string, string>();
  private readonly nodeById = new Map<string, JsonNode>();
  // `Annotated` edges keyed by their `from` (the annotated target node).
  private readonly annotatedByTarget = new Map<string, JsonEdge[]>();

  public constructor(model: TodlDocument)
  {
    const annIds = new Set(model.nodes.filter((n) => n.metaKind === MetaKind.Annotation).map((n) => n.id));
    for (const n of model.nodes) this.nodeById.set(n.id, n);
    for (const e of model.edges)
    {
      if (e.kind === EXTENDS && annIds.has(e.from)) this.baseOf.set(e.from, e.to);
      else if (e.kind === ANNOTATED)
      {
        const list = this.annotatedByTarget.get(e.from);
        if (list === undefined) this.annotatedByTarget.set(e.from, [e]);
        else list.push(e);
      }
    }
  }

  // The annotation name plus every ancestor up the `Extends` chain (cycle-safe).
  private Chain(name: string): string[]
  {
    const names = [name];
    const seen = new Set([name]);
    let cur = this.baseOf.get(name);
    while (cur !== undefined && !seen.has(cur))
    {
      names.push(cur);
      seen.add(cur);
      cur = this.baseOf.get(cur);
    }
    return names;
  }

  /**
   * The projected annotation bag for one target: `Annotated` edges out of
   * `targetId` keyed by the application's annotation name, value = its scalar
   * attrs minus the `namespace` provenance stamp. No annotations → `{}`.
   *
   * Polymorphic: an application of a sub-annotation IS-A its base, so it is also
   * indexed under every ancestor name up the `Extends` chain. The same params
   * object is aliased under each ancestor name of one application (reference
   * identity consumers rely on). Two sub-annotations of one base: last-wins.
   */
  public Project(targetId: string): Record<string, Record<string, unknown>>
  {
    const out: Record<string, Record<string, unknown>> = {};
    const edges = this.annotatedByTarget.get(targetId);
    if (edges === undefined) return out;
    for (const edge of edges)
    {
      const appNode = this.nodeById.get(edge.to);
      if (appNode === undefined) continue;
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>))
      {
        if (k === NAMESPACE_ATTR) continue;
        params[k] = v;
      }
      for (const name of this.Chain(appNode.type ?? "")) out[name] = params;
    }
    return out;
  }
}

/**
 * Project a single target node's annotations from a compiled document — the
 * one-shot convenience over {@link AnnotationProjector}. Callers that project
 * many targets against one document must build an `AnnotationProjector` once and
 * reuse it instead of calling this in a loop (see that class's note).
 */
export function projectAnnotations(model: TodlDocument, targetId: string): Record<string, Record<string, unknown>>
{
  return new AnnotationProjector(model).Project(targetId);
}

/**
 * The instantiable classes a package provides: Instance-tier clabjects
 * (`attrs.class === true`), each an instance of a meta concept and a class for
 * further instantiation. `tier` compares to the "Instance" member-name string
 * because `toJSON` emits the Tier enum by name.
 */
export function deriveClasses(model: TodlDocument, annotationsFrom?: TodlDocument): PublishedClass[]
{
  // Classes are enumerated from `model`, but annotations are projected from
  // `annotationsFrom` when given — so a caller can enumerate an OWN-only document
  // while still resolving icons that inherit from base annotation declarations in
  // the full closure (the special→icon chain).
  const annModel = annotationsFrom ?? model;
  const projector = new AnnotationProjector(annModel);
  const out: PublishedClass[] = [];
  for (const n of model.nodes)
  {
    const attrs = n.attrs as Record<string, unknown>;
    if (n.tier !== "Instance" || !n.isClass) continue;
    const cls: PublishedClass = { id: n.id, concept: n.type ?? "" };
    if (n.localId !== null) cls.localId = n.localId;
    else if (typeof attrs.id === "string") cls.localId = attrs.id;
    if (typeof attrs.label === "string") cls.label = attrs.label;
    const iconAnn = projector.Project(n.id)[ICON_ANNOTATION];
    const iconPath = iconAnn === undefined ? undefined : iconAnn.path;
    if (typeof iconPath === "string") cls.icon = iconPath;
    out.push(cls);
  }
  return out;
}
