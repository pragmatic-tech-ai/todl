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
    type ReflectedNode,
    type TypeInfo,
    type MemberInfo,
    type TermInfo,
    type InstanceMirror,
} from "../manifest/reflection/reflection.js";
import type { ManifestJson } from "../manifest/records.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import { FrozenGraph, Heap, type SeedGraph, type DomainEdge, type DomainToken } from "./graph.js";

// Re-export the substrate types so existing `from "./domain.js"` imports keep working.
export { Heap };
export type { SeedGraph, DomainEdge, DomainToken };

/** A package reference by TODL identity: model id + optional version. */
export interface PackageRef
{
    /** The model id — a Manifest's `model`. */
    model: string;
    /** Exact version; omitted = resolve to the source's latest. */
    version?: string;
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
    /** Optional own-only source document, for the host's query composition. */
    document?: TodlDocument;
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

export class Domain
{
    /** Optional ambient current Domain (≈ AppDomain.CurrentDomain). */
    static current: Domain | undefined;

    /** The graph substrate this domain composes into and reads through. */
    readonly graph = new FrozenGraph();

    readonly onManifestLoaded = new Signal<Manifest>();
    readonly onManifestUnloaded = new Signal<Manifest>();
    readonly onResolveManifest = new Signal<ResolveRequest>();

    private readonly importRefcount = new Map<string, number>(); // identity → # importers
    private readonly depsOf = new Map<string, string[]>(); // identity → its dep identities

    constructor(private readonly packages: PackageSource) {}

    /** The `model@version` identity used for dedup / refcount. */
    static identity(ref: Required<PackageRef>): string
    {
        return FrozenGraph.Identity(ref);
    }

    /** Every currently loaded manifest, in deps-first load order. */
    get manifests(): readonly Manifest[]
    {
        return this.graph.manifests;
    }

    /** The loaded manifest for `model` (latest loaded if `version` omitted). */
    getManifest(model: string, version?: string): Manifest | undefined
    {
        return this.graph.getManifest(model, version);
    }

    // ── Hat 1: package / manifest loader ──────────────────────────────────

    async load(ref: PackageRef): Promise<Manifest>
    {
        const pinned = await this.pin(ref);
        const id = Domain.identity(pinned);
        const existing = this.graph.getManifest(pinned.model, pinned.version);
        if (existing !== undefined) return existing; // dedup + cycle guard

        const resolved = await this.resolvePackage(pinned);
        const manifest = Manifest.load(resolved.manifest);
        this.graph.PreRegister(manifest); // cycle guard BEFORE recursing (sets host + byIdentity)

        const depIds: string[] = [];
        for (const dep of resolved.dependencies) // deps-first
        {
            const depManifest = await this.load(dep);
            const depId = Domain.identity({ model: depManifest.model, version: depManifest.version });
            depIds.push(depId);
            this.importRefcount.set(depId, (this.importRefcount.get(depId) ?? 0) + 1);
        }
        this.depsOf.set(id, depIds);
        this.graph.Finalize(manifest); // deps-first: appended to `order` after its deps
        if (resolved.seed !== undefined) this.graph.BindSeed(resolved.seed, pinned);
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
        for (const node of this.graph.heap.allNodes())
        {
            if (this.nodeBindsTo(node, manifest) && this.graph.originOf(node.id) !== id) return false;
        }

        this.graph.Evict(id); // evict this manifest's own seed nodes
        // Decrement each dependency's import refcount (may make them unloadable).
        for (const depId of this.depsOf.get(id) ?? [])
            this.importRefcount.set(depId, Math.max(0, (this.importRefcount.get(depId) ?? 0) - 1));
        this.depsOf.delete(id);
        this.graph.Deregister(id);
        this.onManifestUnloaded.emit(manifest);
        return true;
    }

    // ── Hat 2: the one heap (delegated) ───────────────────────────────────

    /** Merge `data` into the heap, attributing each node to `boundTo` for unload. */
    bindGraph(data: SeedGraph, boundTo: PackageRef): void
    {
        this.graph.BindSeed(data, boundTo);
    }

    // ── Hat 3: reflection root (delegated) ────────────────────────────────

    /** Resolve "model:fullName" (or a bare name) to a TypeInfo across manifests. */
    getType(qualifiedName: string): TypeInfo | undefined
    {
        return this.graph.getType(qualifiedName);
    }

    /** Dereference a DomainToken to its reflection handle in the owning manifest. */
    resolveToken(token: DomainToken): MemberInfo | TypeInfo | TermInfo | undefined
    {
        return this.graph.resolveToken(token);
    }

    /** Reflect a heap node into an InstanceMirror via its owning manifest. */
    reflect(node: ReflectedNode): InstanceMirror
    {
        return this.graph.reflect(node);
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

    private nodeBindsTo(node: ReflectedNode, manifest: Manifest): boolean
    {
        if (manifest.getType(node.type) !== undefined) return true;
        if (node.class !== undefined && node.class !== null && manifest.getTerm(node.class) !== undefined) return true;
        return false;
    }
}
