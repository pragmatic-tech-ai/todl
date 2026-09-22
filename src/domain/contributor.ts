// The Contributor layer (arc increment 1a-ii): a host-level transform that hides
// packages/sources/registries and yields what the host composes — deps-first
// contributions (documents + precompiled manifests + optional seed) plus a
// resource seam. Packages never cross into the graph.

import type { PackageRef, ResolvedPackage, PackageSource, SeedGraph } from "./domain.js";
import { CompositePackageSource } from "./composite-package-source.js";
import type { ManifestJson } from "../manifest/records.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";

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
    document?: TodlDocument;
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
        if (r.document !== undefined) c.document = r.document;
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
