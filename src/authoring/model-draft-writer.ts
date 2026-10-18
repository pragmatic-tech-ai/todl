import type { Scalar } from "../manifest/logical.js";
import { Cardinality } from "../manifest/enums.js";
import type { IdGenerator } from "../compiler-services/model/id-generator.js";
import { Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { ICypherGraph } from "../cypher/graph.js";
import { CypherWriteError } from "../cypher/errors.js";
import { CypherWriteStats, type ICypherWriter } from "../cypher/writer.js";
import { ModelDraft, type ModelDraftState } from "./model-draft.js";

/**
 * Adapts a {@link ModelDraft} to the Cypher engine's write seam. Writes are origin-only
 * (only instances in the draft's own delta are writable), edges are strictly validated,
 * and a statement is atomic via Snapshot/Restore. `Rollback()` stays valid after
 * `Commit()` so the engine can revert if the post-commit projection throws.
 */
export class ModelDraftWriter implements ICypherWriter
{
    private static readonly NotWritable = "instance is not writable in this model";
    private static readonly UnknownConcept = "unknown concept";
    private static readonly DuplicateId = "generated id already exists";
    private static readonly UnknownMember = "unknown member";
    private static readonly TargetMissing = "relationship target does not exist";
    private static readonly TargetTypeMismatch = "relationship target does not satisfy member";
    private static readonly SingleValued = "member is single-valued and already set";
    private static readonly HasEdges = "cannot delete a node that still has relationships; use DETACH DELETE";
    private static readonly InvalidModel = "write rejected, the model would be invalid";
    private static readonly NoTransaction = "no write transaction is active";
    private static readonly DraftRejected = "write rejected by the model";

    private snapshot: ModelDraftState | undefined;
    private baseline = new Set<string>();
    private deleted = new Set<string>();
    private stats = new CypherWriteStats();

    constructor(
        private readonly draft: ModelDraft,
        private readonly ids: IdGenerator,
        private readonly bake: (draft: ModelDraft) => ICypherGraph,
    )
    {
    }

    public Begin(): void
    {
        this.snapshot = this.draft.Snapshot();
        this.baseline = new Set(this.errors().map((d) => ModelDraftWriter.Key(d)));
        this.deleted = new Set<string>();
        this.stats = new CypherWriteStats();
    }

    public Commit(): ICypherGraph
    {
        const fresh = this.errors().filter((d) => !this.baseline.has(ModelDraftWriter.Key(d)));
        if (fresh.length > 0)
        {
            throw new CypherWriteError(`${ModelDraftWriter.InvalidModel}: ${fresh.map((d) => d.message).join("; ")}`);
        }
        // The snapshot is deliberately kept: Rollback() must still work if the projection fails after this.
        return this.bake(this.draft);
    }

    public Rollback(): void
    {
        if (this.snapshot === undefined) throw new CypherWriteError(ModelDraftWriter.NoTransaction);
        this.draft.Restore(this.snapshot);
    }

    public Stats(): CypherWriteStats
    {
        return this.stats;
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        if (!this.draft.has(concept)) throw new CypherWriteError(`${ModelDraftWriter.UnknownConcept} "${concept}"`);
        const id = this.ids.next();
        if (this.draft.has(id)) throw new CypherWriteError(`${ModelDraftWriter.DuplicateId} "${id}"`);
        this.guard(() =>
        {
            this.draft.create(concept, id);
            for (const [name, value] of properties) this.draft.setField(id, name, value);
        });
        this.stats.NodesCreated++;
        this.stats.PropertiesSet += properties.size;
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.RequireOwn(nodeId);
        if (this.draft.entity(nodeId)?.field(name) === value) return;
        this.guard(() => this.draft.setField(nodeId, name, value));
        this.stats.PropertiesSet++;
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.RequireOwn(nodeId);
        if (this.draft.entity(nodeId)?.field(name) === undefined) return;
        this.guard(() => this.draft.removeField(nodeId, name));
        this.stats.PropertiesSet++;
    }

    public CreateRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.RequireOwn(fromId);
        if (!this.draft.has(toId)) throw new CypherWriteError(`${ModelDraftWriter.TargetMissing} "${toId}"`);
        const fromConcept = this.draft.resolve(fromId)?.type ?? undefined;
        const field = fromConcept === undefined
            ? undefined
            : this.draft.model.effectiveSchema(fromConcept).fields.find((f) => f.name === member);
        if (field === undefined) throw new CypherWriteError(`${ModelDraftWriter.UnknownMember} "${member}"`);
        if (!this.draft.referenceMembers(fromId, toId).some((f) => f.name === member))
        {
            throw new CypherWriteError(`${ModelDraftWriter.TargetTypeMismatch} "${member}"`);
        }
        const existing = this.RefIds(fromId, member);
        if (existing.includes(toId)) return false;
        if (existing.length > 0 && (field.cardinality === Cardinality.One || field.cardinality === Cardinality.Optional))
        {
            throw new CypherWriteError(`${ModelDraftWriter.SingleValued} "${member}"`);
        }
        this.guard(() => this.draft.addRef(fromId, member, toId));
        this.stats.RelationshipsCreated++;
        return true;
    }

    public DeleteRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.RequireOwn(fromId);
        if (!this.RefIds(fromId, member).includes(toId)) return false;
        this.guard(() => this.draft.removeRef(fromId, member, toId));
        this.stats.RelationshipsDeleted++;
        return true;
    }

    public DeleteNode(nodeId: string, detach: boolean): void
    {
        // A node already deleted earlier in this statement (matched by several rows) is a no-op.
        if (this.deleted.has(nodeId)) return;
        this.RequireOwn(nodeId);
        const incident = this.draft.incidentEdgeCount(nodeId);
        if (!detach && incident > 0) throw new CypherWriteError(`${ModelDraftWriter.HasEdges}: "${nodeId}"`);
        this.guard(() => this.draft.remove(nodeId));
        this.deleted.add(nodeId);
        this.stats.NodesDeleted++;
        this.stats.RelationshipsDeleted += incident;
    }

    private RequireOwn(nodeId: string): void
    {
        if (!this.draft.owns(nodeId)) throw new CypherWriteError(`${ModelDraftWriter.NotWritable}: "${nodeId}"`);
    }

    private RefIds(fromId: string, member: string): string[]
    {
        return this.draft.entity(fromId)?.refs(member).map((e) => e.id) ?? [];
    }

    private errors(): Diagnostic[]
    {
        return this.draft.diagnostics.filter((d) => d.severity === Severity.Error);
    }

    private static Key(d: Diagnostic): string
    {
        return `${d.code}|${d.message}`;
    }

    // Translate any ModelDraft failure into the engine's write error so the query rolls back.
    private guard(action: () => void): void
    {
        try
        {
            action();
        }
        catch (e)
        {
            if (e instanceof CypherWriteError) throw e;
            throw new CypherWriteError(`${ModelDraftWriter.DraftRejected}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
