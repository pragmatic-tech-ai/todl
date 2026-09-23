// The Contributor layer (arc increment 1a-ii): a host-level transform that hides
// packages/sources/registries and yields what the host composes — deps-first
// contributions (documents + precompiled manifests + optional seed) plus a
// resource seam. Packages never cross into the graph.

import type { PackageRef, ResolvedPackage, PackageSource, SeedGraph } from "./domain.js";
import { CompositePackageSource } from "./composite-package-source.js";
import type { ManifestJson } from "../manifest/records.js";

/** Identity of a contributed unit (a model pinned to a version). */
export interface ManifestIdentity
{
    model: string;
    version: string;
}

/** One deps-first unit the host composes: reflection metadata + instance document (+ seed). */
export interface Contribution
{
    identity: ManifestIdentity;
    manifest: Uint8Array | ManifestJson;
    seed?: SeedGraph;
    dependencies: readonly PackageRef[];
}

/** Content behind a resource URI (icon svg, wiki markdown, binary asset). */
export interface ResourceContent
{
    uri: string;
    mime: string;
    bytes: Uint8Array;
}

/** The transform: yields contributions to compose + resolves resource URIs. */
export interface Contributor
{
    /** The root refs this contributor asks the host to compose. */
    readonly Roots: readonly PackageRef[];
    /** Deps-first, closure-complete contributions this contributor provides. */
    Contributions(): Promise<readonly Contribution[]>;
    /** Resolve a resource URI to its content, or undefined if not owned here. */
    Resource(uri: string): Promise<ResourceContent | undefined>;
}

/** Shared Contribution mapper (packages stay internal to the contributor layer). */
export class Contributions
{
    static from(r: ResolvedPackage): Contribution
    {
        const c: Contribution = {
            identity: { model: r.ref.model, version: r.ref.version },
            manifest: r.manifest,
            dependencies: r.dependencies,
        };
        if (r.seed !== undefined) c.seed = r.seed;
        return c;
    }
}

/** A contributor over an inlined, already-resolved package set (the browser bundle). */
export class BundledContributor implements Contributor
{
    constructor(
        private readonly packages: readonly ResolvedPackage[],
        readonly Roots: readonly PackageRef[],
    ) {}

    Contributions(): Promise<readonly Contribution[]>
    {
        return Promise.resolve(this.packages.map((p) => Contributions.from(p)));
    }

    Resource(_uri: string): Promise<ResourceContent | undefined>
    {
        return Promise.resolve(undefined); // no asset store in the pipeline yet (see spec)
    }
}

/** A contributor that resolves its libraries' closure from live package sources. */
export class PackagesContributor implements Contributor
{
    private readonly source: CompositePackageSource;

    constructor(sources: readonly PackageSource[], readonly Roots: readonly PackageRef[])
    {
        this.source = new CompositePackageSource(sources);
    }

    async Contributions(): Promise<readonly Contribution[]>
    {
        const out: Contribution[] = [];
        const seen = new Set<string>();
        for (const root of this.Roots) await this.visit(root, seen, out);
        return out;
    }

    Resource(_uri: string): Promise<ResourceContent | undefined>
    {
        return Promise.resolve(undefined); // no asset store in the pipeline yet (see spec)
    }

    private async visit(ref: PackageRef, seen: Set<string>, out: Contribution[]): Promise<void>
    {
        // Skip refs this contributor cannot resolve: the host's load loop composes
        // the roots and turns any unresolvable one into a single diagnostic, so a
        // missing sibling must not abort the whole closure here.
        const resolved = await this.tryResolve(ref);
        if (resolved === undefined) return;
        const id = `${resolved.ref.model}@${resolved.ref.version}`;
        if (seen.has(id)) return;
        seen.add(id);
        for (const d of resolved.dependencies) await this.visit(d, seen, out); // deps-first
        out.push(Contributions.from(resolved));
    }

    private async tryResolve(ref: PackageRef): Promise<ResolvedPackage | undefined>
    {
        try
        {
            return await this.source.resolve(await this.pin(ref));
        }
        catch
        {
            return undefined;
        }
    }

    private async pin(ref: PackageRef): Promise<Required<PackageRef>>
    {
        if (ref.version !== undefined) return { model: ref.model, version: ref.version };
        if (this.source.versions !== undefined)
        {
            const versions = await this.source.versions(ref.model);
            const latest = versions[versions.length - 1];
            if (latest !== undefined) return { model: ref.model, version: latest };
        }
        throw new Error(`cannot pin a version for "${ref.model}" (no version given, no versions())`);
    }
}
