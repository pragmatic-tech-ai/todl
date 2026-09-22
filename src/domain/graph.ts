// The graph substrate + reflection engine (arc increment 1a-i). Extracted from
// Domain so the graph — not the loader — owns the heap, the manifest registry,
// the ManifestHost role, and the reflection surface. Domain composes into it.

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

/** A relationship edge a seed contributes to the heap. */
export interface DomainEdge
{
    from: string;
    rel: string;
    to: string;
}

/** Flattened seed instances contributed to the one heap. */
export interface SeedGraph
{
    nodes: readonly ReflectedNode[];
    edges?: readonly DomainEdge[];
}

/** A graph-scoped address into a specific loaded manifest's tables. */
export interface DomainToken
{
    manifestId: string;
    table: number;
    row: number;
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

/**
 * The frozen (compose-once) graph substrate. Owns the manifest registry, the
 * heap, seed-origin attribution, and the multi-manifest reflection engine; it
 * is the ManifestHost that hops cross-manifest TypeRefs. Reactive/extensible
 * variants layer change-handling on this base later in the arc.
 */
export class FrozenGraph implements ManifestHost
{
    private readonly byIdentity = new Map<string, Manifest>();
    private readonly order: Manifest[] = [];
    private readonly seedOrigin = new Map<string, string>(); // node id → origin identity
    private readonly nodes = new Heap();

    /** The `model@version` identity used for dedup / attribution. */
    static Identity(ref: { model: string; version: string }): string
    {
        return `${ref.model}@${ref.version}`;
    }

    /** The internal heap (read/write surface used by the Domain delegators). */
    get heap(): Heap
    {
        return this.nodes;
    }

    /** Heap read surface, delegated so `graph.size`/`getNode`/`allNodes` read directly. */
    get size(): number
    {
        return this.nodes.size;
    }

    getNode(id: string): ReflectedNode | undefined
    {
        return this.nodes.getNode(id);
    }

    allNodes(): ReflectedNode[]
    {
        return this.nodes.allNodes();
    }

    /** Every registered manifest, in registration (deps-first) order. */
    get manifests(): readonly Manifest[]
    {
        return this.order;
    }

    /**
     * Pre-register a manifest for cycle-guarding BEFORE its deps load: wire the
     * host back-link and make it resolvable by identity, but NOT yet part of the
     * deps-first `order` (it appears in `manifests` only after `Finalize`).
     */
    PreRegister(manifest: Manifest): void
    {
        manifest.setHost(this);
        this.byIdentity.set(FrozenGraph.Identity({ model: manifest.model, version: manifest.version }), manifest);
    }

    /** Finalize registration: append to the deps-first `order` (after deps loaded). */
    Finalize(manifest: Manifest): void
    {
        this.order.push(manifest);
    }

    /** Remove a manifest from the registry and clear its host back-link. */
    Deregister(identity: string): void
    {
        const manifest = this.byIdentity.get(identity);
        if (manifest === undefined) return;
        this.byIdentity.delete(identity);
        const idx = this.order.indexOf(manifest);
        if (idx >= 0) this.order.splice(idx, 1);
        manifest.setHost(undefined);
    }

    getManifest(model: string, version?: string): Manifest | undefined
    {
        if (version !== undefined) return this.byIdentity.get(FrozenGraph.Identity({ model, version }));
        let found: Manifest | undefined;
        for (const m of this.order) if (m.model === model) found = m;
        return found;
    }

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
        return resolved !== undefined && "getTerms" in resolved ? undefined : resolved;
    }

    /** Reflect a heap node into an InstanceMirror via its owning manifest. */
    reflect(node: ReflectedNode): InstanceMirror
    {
        const owner = this.ownerOf(node.type);
        if (owner === undefined) throw new Error(`no loaded manifest defines type "${node.type}"`);
        return owner.reflect(node);
    }

    /** The loaded manifest that defines type name `typeName`, if any. */
    ownerOf(typeName: string): Manifest | undefined
    {
        for (const m of this.order) if (m.getType(typeName) !== undefined) return m;
        return undefined;
    }

    /** Merge `data` into the heap, attributing each node to `boundTo` for eviction. */
    BindSeed(data: SeedGraph, boundTo: { model: string; version?: string }): void
    {
        const originId = `${boundTo.model}@${boundTo.version ?? "*"}`;
        for (const node of data.nodes)
        {
            if (this.ownerOf(node.type) === undefined)
                throw new Error(`cannot bind node "${node.id}": no loaded manifest defines type "${node.type}"`);
            this.nodes.add(node);
            this.seedOrigin.set(node.id, originId);
        }
        for (const edge of data.edges ?? [])
        {
            const node = this.nodes.getNode(edge.from);
            if (node === undefined) continue;
            const refs = node.refs ?? (node.refs = {});
            refs[edge.rel] = [...(refs[edge.rel] ?? []), edge.to];
        }
    }

    /** The origin identity a heap node was attributed to at BindSeed, if any. */
    originOf(nodeId: string): string | undefined
    {
        return this.seedOrigin.get(nodeId);
    }

    /** Remove every heap node attributed to `identity`. */
    Evict(identity: string): void
    {
        for (const node of this.nodes.allNodes())
        {
            if (this.seedOrigin.get(node.id) === identity)
            {
                this.nodes.remove(node.id);
                this.seedOrigin.delete(node.id);
            }
        }
    }
}
