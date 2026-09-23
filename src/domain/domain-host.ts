import { Domain, type PackageRef, type ResolvedPackage } from "./domain.js";
import { MemoryPackageSource } from "./memory-package-source.js";
import type { Contributor, Contribution, ResourceContent } from "./contributor.js";
import { GraphQuery } from "../graph-api/graph-query-engine.js";
import type { IGraphQuery } from "../graph-api/graph-query.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";

// The host's read/compose contract (also the type a caller holds).
export interface IDomainHost
{
    readonly Domain: Domain;
    readonly Diagnostics: readonly Diagnostic[];
    Compose(): Promise<void>;
    Query(): IGraphQuery;
    Resource(uri: string): Promise<ResourceContent | undefined>;
}

// Composes a set of contributors into one Domain: gathers their deps-first
// contributions, dedupes by identity, feeds them to the Domain through an
// in-memory package source, loads each contributor's roots, and exposes a
// document-backed query over the composed set. Contributors hide packages; the
// graph only ever sees manifests + seeds via the unchanged Domain.
export class DomainHost implements IDomainHost
{
    private readonly source = new MemoryPackageSource();
    private readonly domain = new Domain(this.source);
    private contributions: Contribution[] = [];
    private diagnostics: Diagnostic[] = [];

    constructor(private readonly contributors: readonly Contributor[]) {}

    public get Domain(): Domain
    {
        return this.domain;
    }

    public get Diagnostics(): readonly Diagnostic[]
    {
        return this.diagnostics;
    }

    public async Compose(): Promise<void>
    {
        this.diagnostics = [];
        this.contributions = await this.gather();
        for (const c of this.contributions) this.source.Add(DomainHost.toResolved(c));

        const roots: PackageRef[] = [];
        for (const contributor of this.contributors) roots.push(...contributor.Roots);
        for (const ref of roots)
        {
            try
            {
                await this.domain.load(ref);
            }
            catch (err)
            {
                const at = ref.version === undefined ? ref.model : `${ref.model}@${ref.version}`;
                this.diagnostics.push({
                    code: DiagnosticCode.PackageUnresolved,
                    severity: Severity.Error,
                    message: `Cannot compose "${at}": ${(err as Error).message}`,
                    span: null,
                    node: null,
                    path: null,
                });
            }
        }
    }

    public Query(): IGraphQuery
    {
        return new GraphQuery(this.domain.graph);
    }

    // Resolve a resource uri (`<model>/<version>/<path>`) across contributors, first
    // non-undefined wins; undefined when no contributor owns it.
    public async Resource(uri: string): Promise<ResourceContent | undefined>
    {
        for (const c of this.contributors)
        {
            const found = await c.Resource(uri);
            if (found !== undefined) return found;
        }
        return undefined;
    }

    // Ergonomic façade: build, compose, return the loaded host.
    public static async Compose(contributors: readonly Contributor[]): Promise<DomainHost>
    {
        const host = new DomainHost(contributors);
        await host.Compose();
        return host;
    }

    /** Gather every contributor's contributions, deduped by identity (last wins). */
    private async gather(): Promise<Contribution[]>
    {
        const byIdentity = new Map<string, Contribution>();
        for (const contributor of this.contributors)
            for (const contribution of await contributor.Contributions())
                byIdentity.set(`${contribution.identity.model}@${contribution.identity.version}`, contribution);
        return [...byIdentity.values()];
    }

    /** Map a contribution back to the ResolvedPackage the Domain's source serves. */
    private static toResolved(c: Contribution): ResolvedPackage
    {
        const r: ResolvedPackage = {
            ref: { model: c.identity.model, version: c.identity.version },
            manifest: c.manifest,
            dependencies: c.dependencies,
        };
        if (c.seed !== undefined) r.seed = c.seed;
        return r;
    }
}
