import { toJSON } from "../../compiler-services/emit/json.js";
import type { IdGenerator } from "../../compiler-services/model/id-generator.js";
import { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import type { Scalar } from "../../manifest/logical.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { CypherEngine } from "../../cypher/engine.js";
import { CypherWriteError } from "../../cypher/errors.js";
import { GraphQueryAdapter, type ICypherGraph } from "../../cypher/graph.js";
import { CypherWriteStats, type ICypherWriter } from "../../cypher/writer.js";
import type { ModelDraft, ModelDraftState } from "../model-draft.js";

/**
 * Test-only Cypher writer over a {@link ModelDraft}: applies each engine write op to the draft and re-bakes the
 * read graph on Commit. It exists so the TODL Cypher engine's write semantics (MERGE paths, the intra-query
 * overlay) stay covered against a real graph; it does no origin or model-validity checking.
 */
export class DraftTestWriter implements ICypherWriter
{
    private static readonly HasEdges = "cannot delete a node that still has relationships";
    private static readonly NoTransaction = "no write transaction is active";

    private snapshot: ModelDraftState | undefined;
    private deleted = new Set<string>();
    private stats = new CypherWriteStats();

    constructor(private readonly draft: ModelDraft, private readonly ids: IdGenerator)
    {
    }

    public Begin(): void
    {
        this.snapshot = this.draft.Snapshot();
        this.deleted = new Set<string>();
        this.stats = new CypherWriteStats();
    }

    public Commit(): ICypherGraph
    {
        return DraftCypherHarness.Bake(this.draft);
    }

    public Rollback(): void
    {
        if (this.snapshot === undefined) throw new CypherWriteError(DraftTestWriter.NoTransaction);
        this.draft.Restore(this.snapshot);
    }

    public Stats(): CypherWriteStats
    {
        return this.stats;
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        const id = this.ids.next();
        this.draft.create(concept, id);
        for (const [name, value] of properties) this.draft.setField(id, name, value);
        this.stats.NodesCreated++;
        this.stats.PropertiesSet += properties.size;
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.draft.setField(nodeId, name, value);
        this.stats.PropertiesSet++;
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.draft.RemoveField(nodeId, name);
        this.stats.PropertiesSet++;
    }

    public CreateRelationship(fromId: string, member: string, toId: string): boolean
    {
        if (this.RefIds(fromId, member).includes(toId)) return false;
        this.draft.addRef(fromId, member, toId);
        this.stats.RelationshipsCreated++;
        return true;
    }

    public DeleteRelationship(fromId: string, member: string, toId: string): boolean
    {
        if (!this.RefIds(fromId, member).includes(toId)) return false;
        this.draft.removeRef(fromId, member, toId);
        this.stats.RelationshipsDeleted++;
        return true;
    }

    public DeleteNode(nodeId: string, detach: boolean): void
    {
        if (this.deleted.has(nodeId)) return;
        const incident = this.draft.IncidentEdgeCount(nodeId);
        if (!detach && incident > 0) throw new CypherWriteError(DraftTestWriter.HasEdges);
        this.draft.remove(nodeId);
        this.deleted.add(nodeId);
        this.stats.NodesDeleted++;
        this.stats.RelationshipsDeleted += incident;
    }

    private RefIds(fromId: string, member: string): string[]
    {
        return this.draft.entity(fromId)?.refs(member).map((e) => e.id) ?? [];
    }
}

/** Bakes a {@link ModelDraft} into a read-only Cypher graph and builds engines over it, for authoring tests. */
export class DraftCypherHarness
{
    private static readonly DefaultVersion = "0.0.0";

    public static Bake(draft: ModelDraft): ICypherGraph
    {
        const model = draft.namespace;
        const resolved = PackageManifestBridge.toResolvedJsonDocument(toJSON(draft.model), model, DraftCypherHarness.DefaultVersion, []);
        const manifest = Manifest.load(resolved.manifest);
        const graph = new MetadataSnapshot();
        graph.PreRegister(manifest);
        graph.Finalize(manifest);
        if (resolved.seed !== undefined) graph.BindSeed(resolved.seed, { model, version: DraftCypherHarness.DefaultVersion });
        return new GraphQueryAdapter(new GraphQuery(graph));
    }

    /** A fresh engine per statement: the engine fixes its read graph at construction. */
    public static Engine(draft: ModelDraft, writer?: ICypherWriter): CypherEngine
    {
        return new CypherEngine(DraftCypherHarness.Bake(draft), undefined, writer);
    }
}
