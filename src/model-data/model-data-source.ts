// The runtime data-access base for a single TODL model: a typed façade over a
// one-package reflection graph. Materialize either from a document already in
// hand (`loadDocument`, synchronous — the read-client / fromJSON case) or from
// an IModelDataConnector at application startup (`Prepare`, asynchronous).
// Generalizes the former ReflectedRepository: the document-backed case is one
// connector among others. Hands out identity-mapped ReflectedEntity handles so
// a reference always resolves to the same sibling object.

import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../compiler-services/emit/json.js";
import { FrozenGraph } from "../domain/graph.js";
import { GraphQuery } from "../graph-api/graph-query-engine.js";
import { Manifest, type TaxonomyInfo } from "../manifest/reflection/reflection.js";
import { PackageManifestBridge } from "../solution-services/package-manager/package-manifest-bridge.js";
import { ReflectedEntity, MirrorReader, TermReader, type EntityReader, type EntityHost } from "../reflection-client/reflected-entity.js";
import type { IModelDataConnector } from "./model-data-connector.js";

export abstract class ModelDataSource implements EntityHost
{
    private static readonly NoConnectorMessage =
        "ModelDataSource.Prepare requires a connector; construct the source with one, or use the synchronous document path.";

    private prepared = false;
    private graph!: FrozenGraph;
    private query!: GraphQuery;
    private readonly entities = new Map<string, ReflectedEntity>();

    protected modelName = "";
    protected modelVersion = "";

    protected constructor(private readonly connector?: IModelDataConnector)
    {
    }

    /** Startup hook: pull this model's document via the connector, then materialize. */
    public async Prepare(services: IServiceProvider): Promise<void>
    {
        if (this.prepared) return;
        if (this.connector === undefined)
        {
            throw new Error(ModelDataSource.NoConnectorMessage);
        }
        this.loadDocument(await this.connector.Prepare(services));
        this.prepared = true;
    }

    /** Build the single-package reflection substrate from a document in hand (SYNC). */
    protected loadDocument(doc: TodlDocument): void
    {
        const resolved = PackageManifestBridge.toResolvedJsonDocument(doc, this.modelName, this.modelVersion, []);
        const manifest = Manifest.load(resolved.manifest);
        const graph = new FrozenGraph();
        graph.PreRegister(manifest);
        graph.Finalize(manifest);
        if (resolved.seed !== undefined) graph.BindSeed(resolved.seed, { model: this.modelName, version: this.modelVersion });
        this.graph = graph;
        this.query = new GraphQuery(graph);
    }

    protected instancesOf(concept: string): readonly ReflectedEntity[]
    {
        return this.query.InstancesOf(concept).map((m) => this.entityFor(new MirrorReader(m)));
    }

    protected termsOf(taxonomy: string): readonly ReflectedEntity[]
    {
        const tax = this.taxonomyOf(taxonomy);
        return tax === undefined ? [] : tax.getTerms().map((t) => this.entityFor(new TermReader(t)));
    }

    /** Domain concept ids in this source (excludes the prelude root), usable with Instances(). */
    public ConceptNames(): readonly string[]
    {
        return this.query.Concepts().map((c) => c.fullName);
    }

    /** Public read of a concept's instances (the generic-host surface over protected instancesOf). */
    public Instances(concept: string): readonly ReflectedEntity[]
    {
        return this.instancesOf(concept);
    }

    public entity(id: string): ReflectedEntity | undefined
    {
        const cached = this.entities.get(id);
        if (cached !== undefined) return cached;
        const node = this.graph.getNode(id);
        if (node === undefined) return undefined;
        return this.entityFor(new MirrorReader(this.graph.reflect(node)));
    }

    protected createEntity(reader: EntityReader): ReflectedEntity
    {
        return new ReflectedEntity(this, reader);
    }

    private entityFor(reader: EntityReader): ReflectedEntity
    {
        const cached = this.entities.get(reader.id);
        if (cached !== undefined) return cached;
        const e = this.createEntity(reader);
        this.entities.set(reader.id, e);
        return e;
    }

    private taxonomyOf(name: string): TaxonomyInfo | undefined
    {
        for (const m of this.graph.manifests)
        {
            const tax = m.getTaxonomy(name);
            if (tax !== undefined) return tax;
        }
        return undefined;
    }
}
