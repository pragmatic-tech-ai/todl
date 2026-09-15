// Domain (SPEC-06): the ApplicationDomain analog and the root of the graph
// engine. It wears three hats — (1) package/manifest loader over an injected
// PackageSource, (2) host of the ONE runtime heap, and (3) the multi-manifest
// reflection root that hops cross-manifest TypeRefs.
//
// Node-shape reconciliation (recorded in JOURNAL): the SPEC-06 draft types the
// heap as `src/model/graph.ts` Graph, but that node has no node-root
// type/class tokens (that is the SPEC-01 shape, not yet built). Until SPEC-01
// lands, the Domain's heap holds the FLATTENED `ReflectedNode` family that
// reflection + the SPEC-03 emitter already use. The `RegistryPackageSource`
// adapter (SPEC-06 task 12) is deferred: it needs packages to ship SPEC-04
// manifest bytes, which the publish pipeline does not yet emit.

import { Signal } from "@pragmatic-tech-ai/todl-runtime";
import {
    Manifest,
    Tokens,
    type ManifestHost,
    type ReflectedNode,
    type TypeInfo,
    type MemberInfo,
    type TermInfo,
    type InstanceMirror,
} from "../manifest/reflection/reflection.js";
import type { ManifestJson } from "../manifest/records.js";

/** A package reference by TODL identity: model id + optional version. */
export interface PackageRef
{
    /** The model id — a Manifest's `model`. */
    model: string;
    /** Exact version; omitted = resolve to the source's latest. */
    version?: string;
}

/** A domain-scoped address into a specific loaded manifest's tables. */
export interface DomainToken
{
    /** Identity of the owning Manifest (its `model@version`). */
    manifestId: string;
    /** SPEC-04 table id (u8 code). */
    table: number;
    /** 1-based row within that table (0 = null). */
    row: number;
}

/** A relationship edge a package seeds into the heap. */
export interface DomainEdge
{
    from: string;
    rel: string;
    to: string;
}

/** Flattened seed instances a package contributes to the one heap. */
export interface SeedGraph
{
    nodes: readonly ReflectedNode[];
    edges?: readonly DomainEdge[];
}

/** The manifest bytes + deps + optional seed a source resolves for a ref. */
export interface ResolvedPackage
{
    /** The pinned identity the source resolved `ref` to. */
    ref: Required<PackageRef>;
    /** SPEC-04 manifest payload: binary bytes OR the JSON debug view. */
    manifest: Uint8Array | ManifestJson;
    /** Declared package dependencies as domain-tier refs. */
    dependencies: readonly PackageRef[];
    /** Optional seed instance nodes/edges merged into the heap. */
    seed?: SeedGraph;
}

/** The Domain's package backend — a real injected dependency. */
export interface PackageSource
{
    /** Resolve a ref to its manifest + deps + seed; rejects if unknown. */
    resolve(ref: PackageRef): Promise<ResolvedPackage>;
    /** Optional: enumerate concrete versions for a model (latest pinning). */
    versions?(model: string): Promise<readonly string[]>;
}

/** The payload of `onResolveManifest`: the unresolved ref + a reply slot. */
export interface ResolveRequest
{
    ref: PackageRef;
    /** A handler sets this to satisfy the resolve; first non-undefined wins. */
    resolved?: ResolvedPackage;
}

/** The one runtime heap: a store of flattened, self-contained data nodes. */
export class Heap
{
    private readonly byId = new Map<string, ReflectedNode>();

    add(node: ReflectedNode): void
    {
        this.byId.set(node.id, node);
    }

    remove(id: string): void
    {
        this.byId.delete(id);
    }

    getNode(id: string): ReflectedNode | undefined
    {
        return this.byId.get(id);
    }

    allNodes(): ReflectedNode[]
    {
        return [...this.byId.values()];
    }

    get size(): number
    {
        return this.byId.size;
    }
}

export class Domain implements ManifestHost
{
    /** Optional ambient current Domain (≈ AppDomain.CurrentDomain). */
    static current: Domain | undefined;

    /** The single runtime graph — the session heap / live project. */
    readonly graph = new Heap();

    readonly onManifestLoaded = new Signal<Manifest>();
    readonly onManifestUnloaded = new Signal<Manifest>();
    readonly onResolveManifest = new Signal<ResolveRequest>();

    private readonly byIdentity = new Map<string, Manifest>();
    private readonly order: Manifest[] = [];
    private readonly importRefcount = new Map<string, number>(); // identity → # importers
    private readonly depsOf = new Map<string, string[]>(); // identity → its dep identities
    private readonly seedOrigin = new Map<string, string>(); // node id → origin identity

    constructor(private readonly packages: PackageSource) {}

    /** The `model@version` identity used for dedup / refcount. */
    static identity(ref: Required<PackageRef>): string
    {
        return `${ref.model}@${ref.version}`;
    }

    /** Every currently loaded manifest, in deps-first load order. */
    get manifests(): readonly Manifest[]
    {
        return this.order;
    }

    /** The loaded manifest for `model` (latest loaded if `version` omitted). */
    getManifest(model: string, version?: string): Manifest | undefined
    {
        if (version !== undefined) return this.byIdentity.get(Domain.identity({ model, version }));
        let found: Manifest | undefined;
        for (const m of this.order) if (m.model === model) found = m;
        return found;
    }

    // ── Hat 1: package / manifest loader ──────────────────────────────────

    async load(ref: PackageRef): Promise<Manifest>
    {
        const pinned = await this.pin(ref);
        const id = Domain.identity(pinned);
        const existing = this.byIdentity.get(id);
        if (existing !== undefined) return existing; // dedup + cycle guard

        const resolved = await this.resolvePackage(pinned);
        const manifest = Manifest.load(resolved.manifest);
        manifest.setHost(this);
        this.byIdentity.set(id, manifest); // register BEFORE recursing (cycle guard)

        const depIds: string[] = [];
        for (const dep of resolved.dependencies) // deps-first
        {
            const depManifest = await this.load(dep);
            const depId = Domain.identity({ model: depManifest.model, version: depManifest.version });
            depIds.push(depId);
            this.importRefcount.set(depId, (this.importRefcount.get(depId) ?? 0) + 1);
        }
        this.depsOf.set(id, depIds);
        this.order.push(manifest); // deps-first: pushed after its deps
        if (resolved.seed !== undefined) this.bindGraph(resolved.seed, pinned);
        this.onManifestLoaded.emit(manifest);
        return manifest;
    }

    tryUnload(ref: PackageRef): boolean
    {
        const manifest = this.getManifest(ref.model, ref.version);
        if (manifest === undefined) return false;
        const id = Domain.identity({ model: manifest.model, version: manifest.version });

        // Guard B — import refcount: a dependency can't be unloaded under a dependent.
        if ((this.importRefcount.get(id) ?? 0) > 0) return false;
        // Guard A — graph refcount: a FOREIGN node binding to this manifest refuses.
        for (const node of this.graph.allNodes())
        {
            if (this.nodeBindsTo(node, manifest) && this.seedOrigin.get(node.id) !== id) return false;
        }

        // Pass: evict this manifest's own seed nodes.
        for (const node of this.graph.allNodes())
        {
            if (this.seedOrigin.get(node.id) === id)
            {
                this.graph.remove(node.id);
                this.seedOrigin.delete(node.id);
            }
        }
        // Decrement each dependency's import refcount (may make them unloadable).
        for (const depId of this.depsOf.get(id) ?? [])
            this.importRefcount.set(depId, Math.max(0, (this.importRefcount.get(depId) ?? 0) - 1));
        this.depsOf.delete(id);
        this.byIdentity.delete(id);
        const idx = this.order.indexOf(manifest);
        if (idx >= 0) this.order.splice(idx, 1);
        manifest.setHost(undefined);
        this.onManifestUnloaded.emit(manifest);
        return true;
    }

    // ── Hat 2: the one heap ───────────────────────────────────────────────

    /** Merge `data` into the heap, attributing each node to `boundTo` for unload. */
    bindGraph(data: SeedGraph, boundTo: PackageRef): void
    {
        const originId = `${boundTo.model}@${boundTo.version ?? "*"}`;
        for (const node of data.nodes)
        {
            if (this.ownerOf(node.type) === undefined)
                throw new Error(`cannot bind node "${node.id}": no loaded manifest defines type "${node.type}"`);
            this.graph.add(node);
            this.seedOrigin.set(node.id, originId);
        }
        for (const edge of data.edges ?? [])
        {
            const node = this.graph.getNode(edge.from);
            if (node === undefined) continue;
            const refs = node.refs ?? (node.refs = {});
            refs[edge.rel] = [...(refs[edge.rel] ?? []), edge.to];
        }
    }

    // ── Hat 3: reflection root ────────────────────────────────────────────

    /** Resolve "model:fullName" (or a bare name) to a TypeInfo across manifests. */
    getType(qualifiedName: string): TypeInfo | undefined
    {
        const colon = qualifiedName.indexOf(":");
        if (colon >= 0)
        {
            const model = qualifiedName.slice(0, colon);
            const name = qualifiedName.slice(colon + 1);
            return this.getManifest(model)?.getType(name);
        }
        for (const m of this.order)
        {
            const type = m.getType(qualifiedName);
            if (type !== undefined) return type;
        }
        return undefined;
    }

    /** Dereference a DomainToken to its reflection handle in the owning manifest. */
    resolveToken(token: DomainToken): MemberInfo | TypeInfo | TermInfo | undefined
    {
        const manifest = this.byIdentity.get(token.manifestId);
        if (manifest === undefined) return undefined;
        const resolved = manifest.resolveToken(Tokens.of(token.table, token.row));
        // TaxonomyInfo is outside this method's declared union; narrow it out.
        return resolved !== undefined && "getTerms" in resolved ? undefined : resolved;
    }

    /** Reflect a heap node into an InstanceMirror via its owning manifest. */
    reflect(node: ReflectedNode): InstanceMirror
    {
        const owner = this.ownerOf(node.type);
        if (owner === undefined)
            throw new Error(`no loaded manifest defines type "${node.type}"`);
        return owner.reflect(node);
    }

    // ── internals ─────────────────────────────────────────────────────────

    private async pin(ref: PackageRef): Promise<Required<PackageRef>>
    {
        if (ref.version !== undefined) return { model: ref.model, version: ref.version };
        if (this.packages.versions !== undefined)
        {
            const versions = await this.packages.versions(ref.model);
            const latest = versions[versions.length - 1];
            if (latest !== undefined) return { model: ref.model, version: latest };
        }
        throw new Error(`cannot pin a version for "${ref.model}" (no version given, no versions())`);
    }

    private async resolvePackage(pinned: Required<PackageRef>): Promise<ResolvedPackage>
    {
        try
        {
            return await this.packages.resolve(pinned);
        }
        catch (err)
        {
            const request: ResolveRequest = { ref: pinned };
            this.onResolveManifest.emit(request); // synchronous fallback (≈ AssemblyResolve)
            if (request.resolved !== undefined) return request.resolved;
            throw err;
        }
    }

    /** The loaded manifest that defines type name `typeName`, if any. */
    private ownerOf(typeName: string): Manifest | undefined
    {
        for (const m of this.order) if (m.getType(typeName) !== undefined) return m;
        return undefined;
    }

    private nodeBindsTo(node: ReflectedNode, manifest: Manifest): boolean
    {
        if (manifest.getType(node.type) !== undefined) return true;
        if (node.class !== undefined && node.class !== null && manifest.getTerm(node.class) !== undefined) return true;
        return false;
    }
}
