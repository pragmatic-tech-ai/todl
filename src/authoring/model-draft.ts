/**
 * A mutable authoring overlay over frozen bases (design spec §7, Component D). A
 * user builds a model by adding typed instances whose reference fields point into
 * the frozen bases (cross-boundary) or at each other.
 *
 * Delta-based: the source of truth is an own `TodlDocument` ({nodes, edges}) that
 * mutators edit directly; the combined working `Repository` (bases ∪ own) is
 * DERIVED on demand and cached, invalidated on every mutation. Only ids added
 * after `on()`/`fromSource()` are "own"; `toJSON()` emits just that delta. Bases
 * are frozen — mutators touch own instances only.
 */

import { Tier, EdgeKind, type NodeId, type Scalar, type Node } from "../compiler-services/model/graph.js";
import { Repository, type FieldSchema } from "../compiler-services/model/model.js";
import { type Entity } from "../compiler-services/model/entity.js";
import { toJSON, fromJSON, type TodlDocument } from "../compiler-services/emit/json.js";
import { checkAgainst } from "../compiler-services/api.js";
import { preludeDocument } from "../compiler-services/stdlib/prelude.js";
import { collectOperators, deriveBindings, emitModelTodl } from "../compiler-services/emit/todl.js";
import type { Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import { ModelBlockSplicer, SourceLayout } from "./source-layout.js";

const INSTANCE_TIER = Tier[Tier.Instance];
const RELATIONSHIP = EdgeKind[EdgeKind.Relationship];
const MODEL_TYPEOF = "model";
const CONTAINS = EdgeKind[EdgeKind.Contains];

/** A plain instance record; Phase 5 codegen emits these, Phase 4 accepts them. */
export interface InstanceDescriptor
{
  concept: string;
  id: string;
  scalars?: ReadonlyMap<string, Scalar>;
  refs?: ReadonlyMap<string, readonly NodeId[]>;
}

/** An opaque, deep-copied capture of a draft's mutable state (see Snapshot/Restore). */
export interface ModelDraftState
{
  readonly own: TodlDocument;
  readonly home: ReadonlyMap<NodeId, string>;
  /** The model container (id) of each own node that has one. */
  readonly models: ReadonlyMap<NodeId, string>;
  /** Each reopened file's `conforms` per model block: file uri → model id → viewpoint. */
  readonly conforms: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** Reopen options: the draft's namespace and, optionally, the model (container id) new instances go to. */
export interface ModelDraftOptions
{
  namespace: string;
  /** The model id (e.g. `shop.M`) a `create` without a home joins; its home defaults to the file declaring it. */
  model?: string;
}

export class ModelDraft
{
  private own: TodlDocument = { nodes: [], edges: [] };
  private modelCache: Repository | undefined = undefined;
  private readonly baseIds: ReadonlySet<NodeId>;
  /** Home file (source uri) of each own node — the file it round-trips to. */
  private readonly home = new Map<NodeId, string>();
  /** The files this draft was reopened from (fromSources), by uri: their original text and role (see SourceLayout). */
  private readonly layouts = new Map<string, SourceLayout>();
  /** The declared model container (id) of each own node, so a re-emit keeps the model a node was declared in. */
  private readonly modelOf = new Map<NodeId, string>();
  /** The file that declares each reopened model (the first, when several do). */
  private readonly modelFile = new Map<string, string>();
  /** The model a `create` without a home joins (ModelDraftOptions.model). */
  private defaultModel: string | undefined = undefined;
  /** Each reopened file's `conforms` per model block (file uri → model id → viewpoint): a block is per file, and a
   *  model split across files carries one viewpoint per file. */
  private blockConforms = new Map<string, Map<string, string>>();

  private constructor(
    /** The frozen bases as documents: [prelude, ...bases]. */
    private readonly baseDocs: readonly TodlDocument[],
    readonly namespace: string,
  )
  {
    this.baseIds = new Set(baseDocs.flatMap((d) => d.nodes.map((n) => n.id)));
  }

  /** Open an empty draft over the given frozen bases (meta-model + libraries). */
  static on(bases: readonly Repository[], opts: { namespace: string }): ModelDraft
  {
    return new ModelDraft([preludeDocument(), ...bases.map((b) => toJSON(b))], opts.namespace);
  }

  /** Reopen a saved `.todl` model as an editable draft: compile it against the
   *  bases and seed the own delta with the non-base instances. A blank source
   *  yields an empty draft. */
  static fromSource(bases: readonly Repository[], source: string, opts: { namespace: string }): ModelDraft
  {
    if (source.trim().length === 0) return ModelDraft.on(bases, opts);
    return ModelDraft.fromSources(bases, [{ uri: `${opts.namespace}.todl`, text: source }], opts);
  }

  /** Reopen SEVERAL `.todl` files as one editable draft (Option B: one model,
   *  many files). Composes them against the bases and records each own node's
   *  home file (the file that defined it) for per-file round-trip. */
  static fromSources(
    bases: readonly Repository[],
    sources: readonly { uri: string; text: string }[],
    opts: ModelDraftOptions,
  ): ModelDraft
  {
    const baseDocs = [preludeDocument(), ...bases.map((b) => toJSON(b))];
    const baseIds = new Set(baseDocs.flatMap((d) => d.nodes.map((n) => n.id)));
    const result = checkAgainst([...baseDocs], sources.map((s) => ({ uri: s.uri, text: s.text })));
    const compiled = toJSON(result.model);
    // Drop the synthesized `model`-container node (typeOf "model") + its Contains
    // edges — it is a serialization artifact, not an editable instance.
    const modelIds = new Set(compiled.nodes.filter((n) => n.metaKind === MODEL_TYPEOF).map((n) => n.id));
    const layouts = new Map(sources.map((s) => [s.uri, SourceLayout.Of(s.uri, s.text)] as const));
    const declared = compiled.nodes.filter((n) => !baseIds.has(n.id) && !modelIds.has(n.id));
    // Schema declared in the member's own files (concepts, taxonomies, ...) is frozen like a base: writes edit
    // instances only, and the round-trip keeps that schema's source text verbatim (toTodlByFile splices). A class
    // declared in a file that carries schema is kept verbatim with it, so it is frozen too.
    const frozen = new Set(declared
      .filter((n) => n.metaKind !== null || (n.isClass === true && layouts.get(result.provenance.get(n.id) ?? "")?.HasSchema === true))
      .map((n) => n.id));
    const schema: TodlDocument = {
      nodes: declared.filter((n) => frozen.has(n.id)),
      edges: compiled.edges.filter((e) => frozen.has(String(e.from))),
    };
    const draft = new ModelDraft(schema.nodes.length > 0 ? [...baseDocs, schema] : baseDocs, opts.namespace);
    draft.own = {
      nodes: declared.filter((n) => !frozen.has(n.id)),
      edges: compiled.edges.filter((e) => !draft.baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
    };
    for (const [uri, layout] of layouts) draft.layouts.set(uri, layout);
    // Home every own id from the loader's authoritative provenance (covers named
    // instances AND loader-minted reified edges / inline objects). The model
    // container id is skipped since it is not an own node.
    const ownIds = new Set(draft.own.nodes.map((n) => n.id));
    for (const [id, uri] of result.provenance) if (ownIds.has(id)) draft.home.set(id, uri);
    // Keep each own node's declared model (its container's id) and where each model is declared, so the re-emit
    // writes `model <declared name>` rather than a synthesized one.
    for (const e of compiled.edges)
    {
      if (e.kind === CONTAINS && modelIds.has(String(e.from)) && ownIds.has(String(e.to))) draft.modelOf.set(String(e.to), String(e.from));
    }
    for (const id of modelIds)
    {
      const uri = result.provenance.get(id);
      if (uri !== undefined && !draft.modelFile.has(id)) draft.modelFile.set(id, uri);
    }
    // Every model block of every reopened file, with its own `conforms` (the loader stamps it on the block's entities).
    for (const n of draft.own.nodes)
    {
      const model = draft.modelOf.get(n.id);
      const uri = draft.home.get(n.id);
      if (model === undefined || uri === undefined) continue;
      const blocks = draft.blockConforms.get(uri) ?? new Map<string, string>();
      draft.blockConforms.set(uri, blocks);
      const viewpoint = (n.attrs as Record<string, Scalar>).conforms;
      if (typeof viewpoint === "string" && !blocks.has(model)) blocks.set(model, viewpoint);
    }
    draft.defaultModel = opts.model;
    return draft;
  }

  /** The home file (source uri) of an own node, or undefined. */
  homeOf(id: NodeId): string | undefined
  {
    return this.home.get(id);
  }

  /** The combined working Repository (bases ∪ own), derived + cached. */
  get model(): Repository
  {
    if (this.modelCache === undefined)
    {
      const nodes = new Map<NodeId, TodlDocument["nodes"][number]>();
      for (const n of [...this.baseDocs.flatMap((d) => d.nodes), ...this.own.nodes]) nodes.set(n.id, n);
      const edges = new Map<string, TodlDocument["edges"][number]>();
      for (const e of [...this.baseDocs.flatMap((d) => d.edges), ...this.own.edges])
        edges.set(`${e.kind}|${e.from}|${e.to}|${e.via}`, e);
      this.modelCache = fromJSON({ nodes: [...nodes.values()], edges: [...edges.values()] });
    }
    return this.modelCache;
  }

  resolve(id: NodeId): Node | undefined
  {
    return this.model.resolve(id);
  }

  has(id: NodeId): boolean
  {
    return this.model.has(id);
  }

  entity(id: NodeId): Entity | undefined
  {
    return this.model.entity(id);
  }

  /** Stage an instance (attrs + reference edges) into the overlay; return its
   *  handle. Fail-fast: throws (atomically, before any mutation) if a reference
   *  target does not exist — no dangling refs are ever staged. */
  add(descriptor: InstanceDescriptor): Entity
  {
    const known = new Set<NodeId>([...this.baseIds, ...this.own.nodes.map((n) => n.id), descriptor.id]);
    for (const [, targets] of descriptor.refs ?? [])
      for (const t of targets)
        if (!known.has(t)) throw new Error(`reference target "${t}" does not exist`);
    this.create(descriptor.concept, descriptor.id);
    for (const [name, value] of descriptor.scalars ?? []) this.setField(descriptor.id, name, value);
    for (const [member, targets] of descriptor.refs ?? [])
      for (const target of targets) this.addRef(descriptor.id, member, target);
    return this.model.entity(descriptor.id)!;
  }

  /** Append a fresh own instance of `concept` with the given id; return its
   *  handle. `home` records the file it round-trips to (see toTodlByFile). */
  create(concept: string, id: NodeId, home?: string): Entity
  {
    // Without a home a new instance joins the draft's model, in the file that declares it.
    const model = this.defaultModel;
    home ??= model === undefined ? undefined : this.modelFile.get(model);
    if (model !== undefined) this.modelOf.set(id, model);
    this.own.nodes.push({
      id,
      tier: INSTANCE_TIER,
      type: concept,
      metaKind: null,
      namespace: null,
      localId: id,
      isClass: false,
      class: null,
      storageId: null,
      canonicalId: null,
      fields: [],
      attrs: {},
    });
    if (home !== undefined) this.home.set(id, home);
    this.invalidate();
    return this.model.entity(id)!;
  }

  /** Set a scalar attr on an OWN instance. Throws for a base (frozen) or unknown id. */
  setField(id: NodeId, name: string, value: Scalar): void
  {
    const node = this.ownNode(id);
    (node.attrs as Record<string, Scalar>)[name] = value;
    this.invalidate();
  }

  /** Delete an attr from an OWN instance (no-op if absent). Throws for a base (frozen) or unknown id. */
  RemoveField(id: NodeId, name: string): void
  {
    const node = this.ownNode(id);
    delete (node.attrs as Record<string, Scalar>)[name];
    this.invalidate();
  }

  /** True when `id` is an own (writable) instance of this draft. */
  Owns(id: NodeId): boolean
  {
    return !this.baseIds.has(id) && this.own.nodes.some((n) => n.id === id);
  }

  /** How many own edges touch `id` (as source or target). */
  IncidentEdgeCount(id: NodeId): number
  {
    return this.own.edges.filter((e) => e.from === id || e.to === id).length;
  }

  /** Deep-copy the mutable state (own delta + home map) for a later Restore. */
  Snapshot(): ModelDraftState
  {
    return { own: structuredClone(this.own), home: new Map(this.home), models: new Map(this.modelOf), conforms: ModelDraft.CopyConforms(this.blockConforms) };
  }

  /** Replace the mutable state with a prior Snapshot (the snapshot stays reusable). */
  Restore(state: ModelDraftState): void
  {
    this.own = structuredClone(state.own);
    this.home.clear();
    for (const [id, uri] of state.home) this.home.set(id, uri);
    this.modelOf.clear();
    for (const [id, model] of state.models) this.modelOf.set(id, model);
    this.blockConforms = ModelDraft.CopyConforms(state.conforms);
    this.invalidate();
  }

  /** Append a reference edge from an OWN instance. Throws if `from` is not own or
   *  `to` does not exist. */
  addRef(from: NodeId, member: string, to: NodeId): void
  {
    this.ownNode(from);
    if (!this.baseIds.has(to) && !this.own.nodes.some((n) => n.id === to))
      throw new Error(`reference target "${to}" does not exist`);
    this.own.edges.push({ kind: RELATIONSHIP, via: member, from, to });
    this.invalidate();
  }

  /** Drop a matching reference edge (no-op if absent). */
  removeRef(from: NodeId, member: string, to: NodeId): void
  {
    this.own.edges = this.own.edges.filter(
      (e) => !(e.kind === RELATIONSHIP && e.from === from && e.via === member && e.to === to),
    );
    this.invalidate();
  }

  /** Remove an own instance and every edge touching it. Throws for a base id. */
  remove(id: NodeId): void
  {
    if (this.baseIds.has(id)) throw new Error(`cannot remove base node "${id}" (frozen)`);
    this.own.nodes = this.own.nodes.filter((n) => n.id !== id);
    this.own.edges = this.own.edges.filter((e) => e.from !== id && e.to !== id);
    this.invalidate();
  }

  /** The reference members of `fromId`'s concept that `toId` could fill — the
   *  concept-typed fields whose type `toId` is (or is a subtype of). */
  referenceMembers(fromId: NodeId, toId: NodeId): FieldSchema[]
  {
    const fromConcept = this.model.resolve(fromId)?.type ?? undefined;
    const toConcept = this.model.resolve(toId)?.type ?? undefined;
    if (fromConcept === undefined || toConcept === undefined) return [];
    const compatible = new Set([toConcept, ...this.model.supertypesOf(toConcept)]);
    return this.model.effectiveSchema(fromConcept).fields.filter((f) => compatible.has(f.type));
  }

  /** The overlay's own instances (excludes all base nodes). */
  ownInstances(): Entity[]
  {
    return this.model
      .allNodes()
      .filter((n) => !this.isBase(n.id))
      .map((n) => this.model.entity(n.id)!);
  }

  /** Validate the overlay against the frozen bases (the vocabulary). */
  get diagnostics(): Diagnostic[]
  {
    return this.model.validate();
  }

  /** Serialize ONLY the overlay delta: own instances + their edges. */
  toJSON(): TodlDocument
  {
    return {
      nodes: this.own.nodes.map((n) => ({ ...n, attrs: { ...(n.attrs as Record<string, Scalar>) } })),
      edges: this.own.edges.map((e) => ({ ...e })),
    };
  }

  /** Serialize the overlay as round-trippable `.todl` model source (own delta + bindings). */
  toTodl(): string
  {
    const own = this.toJSON();
    const bindings = deriveBindings(this.model, this.baseIds, this.namespace, own);
    const emitted = emitModelTodl(own, this.namespace, bindings, this.conformsOf(own), collectOperators(this.model), this.model, this.modelOf, this.ConformsOfAll());
    // Reopened from a single file that carries schema: keep that file's text and replace only its model body.
    if (this.layouts.size !== 1) return emitted;
    const [uri, layout] = [...this.layouts][0]!;
    return layout.HasSchema ? ModelBlockSplicer.Splice(uri, layout.Text, emitted) : emitted;
  }

  /** Serialize the overlay as one `.todl` per home file (Option B multi-file):
   *  own nodes/edges partitioned by home, each file emitting its own model block
   *  with its `conforms <viewpoint>`. Nodes with no recorded home fall to a
   *  single default `${namespace}.todl`. */
  toTodlByFile(): Map<string, string>
  {
    const defaultUri = `${this.namespace}.todl`;
    const files = new Map<string, TodlDocument>();
    const ensure = (uri: string): TodlDocument => {
      let doc = files.get(uri);
      if (doc === undefined) { doc = { nodes: [], edges: [] }; files.set(uri, doc); }
      return doc;
    };
    const own = this.toJSON();
    // Every reopened file that carried the model block is re-emitted, even when every instance in it was deleted —
    // otherwise the deletion is never written and the instances come back on the next load.
    for (const [uri, layout] of this.layouts) if (layout.HasModel) ensure(uri);
    for (const n of own.nodes) ensure(this.home.get(n.id) ?? defaultUri).nodes.push(n);
    for (const e of own.edges) ensure(this.home.get(String(e.from)) ?? defaultUri).edges.push(e);
    const result = new Map<string, string>();
    for (const [uri, doc] of files)
    {
      const bindings = deriveBindings(this.model, this.baseIds, this.namespace, doc);
      const emitted = emitModelTodl(doc, this.namespace, bindings, this.conformsOf(doc), collectOperators(this.model), this.model, this.modelOf, this.blockConforms.get(uri));
      // A file that declares schema beside its model keeps that schema verbatim: only its model body is replaced.
      const layout = this.layouts.get(uri);
      result.set(uri, layout !== undefined && layout.HasSchema ? ModelBlockSplicer.Splice(uri, layout.Text, emitted) : emitted);
    }
    return result;
  }

  /** Every file's block viewpoints merged (the first file's wins per model): the single-text `toTodl` view. */
  private ConformsOfAll(): ReadonlyMap<string, string> | undefined
  {
    if (this.blockConforms.size === 0) return undefined;
    const merged = new Map<string, string>();
    for (const blocks of this.blockConforms.values())
      for (const [model, viewpoint] of blocks) if (!merged.has(model)) merged.set(model, viewpoint);
    return merged;
  }

  private static CopyConforms(source: ReadonlyMap<string, ReadonlyMap<string, string>>): Map<string, Map<string, string>>
  {
    return new Map([...source].map(([uri, blocks]) => [uri, new Map(blocks)] as const));
  }

  /** The shared `conforms` viewpoint of a file's concrete entities (file↔viewpoint
   *  1:1), or undefined when none carry one. */
  private conformsOf(doc: TodlDocument): string | undefined
  {
    for (const n of doc.nodes)
    {
      const c = (n.attrs as Record<string, Scalar>).conforms;
      if (typeof c === "string") return c;
    }
    return undefined;
  }

  /** True when `id` is base (frozen), false when it is an own overlay instance. */
  protected isBase(id: NodeId): boolean
  {
    return this.baseIds.has(id);
  }

  /** An own node by id, or throw (base id → frozen; unknown → no such instance). */
  private ownNode(id: NodeId): TodlDocument["nodes"][number]
  {
    if (this.baseIds.has(id)) throw new Error(`cannot mutate base node "${id}" (frozen)`);
    const node = this.own.nodes.find((n) => n.id === id);
    if (node === undefined) throw new Error(`no own instance "${id}"`);
    return node;
  }

  private invalidate(): void
  {
    this.modelCache = undefined;
  }
}
