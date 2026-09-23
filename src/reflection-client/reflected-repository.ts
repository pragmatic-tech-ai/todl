// A typed package facade over a single-package reflection graph — the FrozenRepository
// successor (SP3). fromJSON-style loading builds a one-package FrozenGraph via the
// PackageManifestBridge, wraps GraphQuery, and hands out identity-mapped ReflectedEntity
// handles so a reference always resolves to the same sibling object.

import type { TodlDocument } from "../compiler-services/emit/json.js";
import { FrozenGraph } from "../domain/graph.js";
import { GraphQuery } from "../graph-api/graph-query-engine.js";
import { Manifest, type TaxonomyInfo } from "../manifest/reflection/reflection.js";
import { PackageManifestBridge } from "../solution-services/package-manager/package-manifest-bridge.js";
import { ReflectedEntity, MirrorReader, TermReader, type EntityReader, type EntityHost } from "./reflected-entity.js";

/** A typed package facade over a single-package reflection graph — the FrozenRepository successor. */
export class ReflectedRepository implements EntityHost
{
    private graph!: FrozenGraph;
    private query!: GraphQuery;
    private readonly entities = new Map<string, ReflectedEntity>();

    /** Build the single-package reflection substrate from a model.json (SYNC). */
    protected load(doc: TodlDocument, model: string, version: string): void
    {
        const resolved = PackageManifestBridge.toResolvedJsonDocument(doc, model, version, []);
        const manifest = Manifest.load(resolved.manifest);
        const graph = new FrozenGraph();
        graph.PreRegister(manifest);
        graph.Finalize(manifest);
        if (resolved.seed !== undefined) graph.BindSeed(resolved.seed, { model, version });
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
