import { Domain, type PackageSource, type PackageRef } from "./domain.js";
import { CapturingPackageSource } from "./capturing-package-source.js";
import { CompositePackageSource } from "./composite-package-source.js";
import { GraphApi } from "../graph-api/graph-api.js";
import type { IGraphQuery } from "../graph-api/graph-query.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";

// The base abstraction's read/compose contract (also the type a caller holds).
export interface IDomainHost
{
    readonly Domain: Domain;
    readonly Diagnostics: readonly Diagnostic[];
    Compose(libraries: readonly PackageRef[]): Promise<void>;
    Query(): IGraphQuery;
}

// The base abstraction: composes a set of libraries into one Domain over an injected
// PackageSource, collecting per-library diagnostics, and exposes a GraphApi-shaped
// query over the composed (deps-first) document closure. Subclasses supply the source.
export abstract class DomainHostBase implements IDomainHost
{
    private readonly capturing: CapturingPackageSource;
    private readonly domain: Domain;
    private diagnostics: Diagnostic[] = [];

    protected constructor(source: PackageSource)
    {
        this.capturing = new CapturingPackageSource(source);
        this.domain = new Domain(this.capturing);
    }

    public get Domain(): Domain
    {
        return this.domain;
    }

    public get Diagnostics(): readonly Diagnostic[]
    {
        return this.diagnostics;
    }

    public async Compose(libraries: readonly PackageRef[]): Promise<void>
    {
        this.diagnostics = [];
        for (const ref of libraries)
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
        const documents: TodlDocument[] = [];
        for (const manifest of this.domain.manifests)
        {
            const doc = this.capturing.DocumentFor(Domain.identity({ model: manifest.model, version: manifest.version }));
            if (doc !== undefined) documents.push(doc);
        }
        return GraphApi.FromDocuments(documents);
    }
}

// The default host: composes over an ordered collection of package sources.
export class DomainHost extends DomainHostBase
{
    constructor(sources: readonly PackageSource[])
    {
        super(new CompositePackageSource(sources));
    }

    // Ergonomic library façade: build, compose, return the loaded host.
    public static async Compose(sources: readonly PackageSource[], libraries: readonly PackageRef[]): Promise<DomainHost>
    {
        const host = new DomainHost(sources);
        await host.Compose(libraries);
        return host;
    }
}
