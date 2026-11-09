import {
    WriteOp,
    type CellValue,
    type ConnectorChange,
    type ConnectorChangeSet,
    type IConnectorTransaction,
    type IGraphConnector,
} from '@pragmatic-tech-ai/graph';
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime';
import { MetaKind } from '../compiler-services/model/kinds.js';
import type { Scalar } from '../compiler-services/model/graph.js';
import { NumericText } from '../compiler-services/emit/numeric-text.js';
import { Cardinality } from '../manifest/enums.js';
import { EngineBridgeError, EngineBridgeErrorCode } from './EngineBridgeError.js';
import { MessageFormat } from './MessageFormat.js';
import type { ITodlDraftSession, ITodlModelWorkspace } from './TodlModelWorkspace.js';
import { TodlNames } from './TodlNames.js';

/**
 * Engine cell → TODL scalar: strings and booleans as is; finite numbers and bigints as decimal strings, the form the
 * parser keeps numeric literals in. The emitter writes a numeric field's plain decimal (`5`, `2.5`) bare and quotes
 * the rest (`"-3"`, `"1e-7"`): TODL has no negative or exponent literal, and the quoted form re-parses to the same
 * text, which the describer reads back as the same number.
 */
class TodlValueConverter
{
    private static readonly UnsupportedMessage = 'Member "{0}" of "{1}" cannot hold this value in a .todl file';

    /** The scalar to write, or null to remove the field. */
    public static ToScalar(id: string, member: string, value: CellValue): Scalar | null
    {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
        {
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value))
        {
            // NumericText keeps -0's sign so a Float64 -0 reads back as -0.
            return NumericText.Of(value);
        }
        if (typeof value === 'bigint')
        {
            return String(value);
        }
        // NaN / Infinity, DateValue / DateTimeValue / DurationValue: no .todl literal holds them.
        throw TodlValueConverter.Unsupported(id, member);
    }

    public static Unsupported(id: string, member: string): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, MessageFormat.Format(TodlValueConverter.UnsupportedMessage, member, id));
    }
}

/** Applies engine changes to one model's draft session (spec §6): the engine ops as ModelDraft edits. */
class TodlDraftEditor
{
    private static readonly IdSeparator = '.';
    private static readonly NoLocalId = '';
    private static readonly LocalIdPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    private static readonly ForeignMessage = 'Node "{0}" is not an id of namespace "{1}"';
    private static readonly ExistsMessage = 'Node "{0}" already exists in the model\'s sources';
    private static readonly RejectedMessage = 'The model\'s sources cannot take this write: {0}';
    private static readonly EdgeOptionsMessage = 'Link "{0}" of "{1}" carries placement or properties, which .todl references cannot hold';
    private static readonly ClassMessage = 'Member "{0}" of "{1}" is read-only';
    private static readonly NotOwnMessage = 'Node "{0}" is not an instance these sources hold';
    private static readonly ClassFixedMessage = 'Member "{0}" of "{1}" is fixed by the instance\'s class: clearing it would revert to the class value on recompile';
    private static readonly UnknownOpMessage = 'Change kind {0} cannot be written to .todl sources';
    // Ruling PF-e: an Unlink's ends may be hidden from the writer (a delete's incident edge), so these name neither node.
    private static readonly UnlinkNotOwnMessage = 'A link of "{0}" is not held by these sources';
    private static readonly UnlinkRejectedMessage = 'The model\'s sources cannot remove a link of "{0}"';

    public constructor(private readonly session: ITodlDraftSession)
    {
    }

    public Apply(change: ConnectorChange): void
    {
        switch (change.Op)
        {
            case WriteOp.CreateNode:
                this.Create(change.PublicId, change.Concept);
                break;
            case WriteOp.SetProperty:
                this.Set(change.PublicId, change.Member, change.Value);
                break;
            case WriteOp.Link:
                if (change.Options !== undefined && (change.Options.AfterSibling !== undefined || change.Options.BeforeSibling !== undefined || (change.Options.Properties?.size ?? 0) > 0))
                {
                    throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, MessageFormat.Format(TodlDraftEditor.EdgeOptionsMessage, change.Relationship, change.From));
                }
                this.Edit(() => this.session.Draft.addRef(change.From, change.Relationship, change.To));
                break;
            case WriteOp.Unlink:
                this.Unlink(change.From, change.Relationship, change.To);
                break;
            case WriteOp.DeleteNode:
                this.RequireOwn(change.PublicId);
                this.Edit(() => this.session.Draft.remove(change.PublicId));
                break;
            case WriteOp.SetOwner:
                // Seed synchronization only; the engine never routes it to a connector.
                throw TodlDraftEditor.UnknownOp(change.Op);
            default:
            {
                const unknown: never = change;
                throw TodlDraftEditor.UnknownOp((unknown as ConnectorChange).Op);
            }
        }
    }

    private static UnknownOp(op: WriteOp): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, MessageFormat.Format(TodlDraftEditor.UnknownOpMessage, String(op)));
    }

    /** Ruling PF-e: neither refusal names a node, and a draft refusal is not kept as the cause (its text may). */
    private Unlink(from: string, relationship: string, to: string): void
    {
        if (!this.session.Draft.Owns(from))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlDraftEditor.UnlinkNotOwnMessage, relationship));
        }
        try
        {
            this.session.Draft.removeRef(from, relationship, to);
        }
        catch
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlDraftEditor.UnlinkRejectedMessage, relationship));
        }
    }

    private Create(id: string, concept: string): void
    {
        const prefix = this.session.Namespace + TodlDraftEditor.IdSeparator;
        const local = id.startsWith(prefix) ? id.slice(prefix.length) : TodlDraftEditor.NoLocalId;
        if (!TodlDraftEditor.LocalIdPattern.test(local))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ForeignId, MessageFormat.Format(TodlDraftEditor.ForeignMessage, id, this.session.Namespace));
        }
        if (this.session.Draft.has(id))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlDraftEditor.ExistsMessage, id));
        }
        // The draft keys instances by their full id (`ns.local`, as loaded); the emitter writes the local part.
        this.Edit(() => this.session.Draft.create(concept, id));
    }

    private Set(id: string, member: string, value: CellValue): void
    {
        if (member === TodlNames.Class)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, MessageFormat.Format(TodlDraftEditor.ClassMessage, member, id));
        }
        const scalar = TodlValueConverter.ToScalar(id, member, value);
        const draft = this.session.Draft;
        if (this.IsTaxonomyField(id, member))
        {
            // A taxonomy value is a reference to its term in TODL, not an attr.
            if (scalar !== null && typeof scalar !== 'string')
            {
                throw TodlValueConverter.Unsupported(id, member);
            }
            this.RequireOwn(id);
            this.Edit(() =>
            {
                for (const term of draft.entity(id)?.refs(member).map((e) => e.id) ?? [])
                {
                    draft.removeRef(id, member, term);
                }
                if (scalar !== null)
                {
                    draft.addRef(id, member, scalar);
                }
            });
            return;
        }
        if (scalar === null && this.IsClassFixed(id, member))
        {
            // Ruling PF-d: removing the instance's value would let the class value back in on recompile.
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, MessageFormat.Format(TodlDraftEditor.ClassFixedMessage, member, id));
        }
        // `label` is the instance label, held as the `label` attr like any scalar field.
        this.Edit(() =>
        {
            if (scalar === null)
            {
                draft.RemoveField(id, member);
            }
            else
            {
                draft.setField(id, member, scalar);
            }
        });
    }

    /** True for a single-card field typed by a taxonomy (the engine sees it as a String property holding a term id). */
    private IsTaxonomyField(id: string, member: string): boolean
    {
        const draft = this.session.Draft;
        const concept = draft.resolve(id)?.type;
        if (concept === undefined || concept === null)
        {
            return false;
        }
        const field = draft.model.effectiveSchema(concept).fields.find((f) => f.name === member);
        return field !== undefined
            && (field.cardinality === Cardinality.One || field.cardinality === Cardinality.Optional)
            && draft.resolve(field.type)?.metaKind === MetaKind.Taxonomy;
    }

    /** True when the instance's class, or a term broader than it, pins `member`. */
    private IsClassFixed(id: string, member: string): boolean
    {
        const model = this.session.Draft.model;
        const cls = model.classOf(id);
        return cls !== null && [cls, ...model.ancestorsOf(cls)].some((c) => model.resolve(c)?.attrs.has(member) === true);
    }

    /** ModelDraft.remove / removeRef are silent for an id the draft does not own; a write to such a node is not editable. */
    private RequireOwn(id: string): void
    {
        if (!this.session.Draft.Owns(id))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlDraftEditor.NotOwnMessage, id));
        }
    }

    /** Runs a draft edit; a draft refusal (frozen or unknown node, missing target) is NotEditable, the refusal its cause. */
    private Edit(edit: () => void): void
    {
        try
        {
            edit();
        }
        catch (error)
        {
            if (error instanceof EngineBridgeError)
            {
                throw error;
            }
            const reason = error instanceof Error ? error.message : String(error);
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlDraftEditor.RejectedMessage, reason), error);
        }
    }
}

/**
 * One file a commit writes: what it held before and the text the commit puts there. Original undefined: the commit
 * creates it. Completed once WriteFile resolved; until then the file may hold a torn write.
 */
class WrittenFile
{
    public Completed = false;
    /** The session refused the write (EngineBridgeError Stale) and left the file untouched: nothing to restore. */
    public Refused = false;

    public constructor(
        public readonly Owner: string,
        public readonly Session: ITodlDraftSession,
        public readonly Uri: string,
        public readonly Original: string | undefined,
        public readonly Written: string,
    )
    {
    }

    /**
     * Puts the original back; true when the file now holds it. A write that did not complete is restored
     * unconditionally: the model's lock is held, so the file holds this commit's partial text (or the original). A
     * completed write is restored only while the file still holds what this commit wrote; if something else wrote it
     * since, it is left alone (compensating would destroy that write) and this returns false.
     */
    public async Restore(): Promise<boolean>
    {
        if (this.Refused)
        {
            return true;
        }
        try
        {
            const current = await this.Session.ReadFile(this.Uri);
            if (current === this.Original)
            {
                return true;
            }
            if (this.Completed && current !== this.Written)
            {
                return false;
            }
            if (this.Original === undefined)
            {
                await this.Session.DeleteFile(this.Uri);
            }
            else
            {
                await this.Session.WriteFile(this.Uri, this.Original);
            }
            return true;
        }
        catch
        {
            return false;
        }
    }
}

/** A promise and the means to resolve it, as one object. */
class ResolvablePromise
{
    public readonly Promise: Promise<void>;
    private resolve: () => void = () => undefined;

    public constructor()
    {
        this.Promise = new Promise<void>((resolve) => { this.resolve = resolve; });
    }

    public Resolve(): void
    {
        this.resolve();
    }
}

/** A held commit lock on one model; dispose() releases it (once) and lets the model's next commit in. */
class ModelLease implements IDisposable
{
    private released = false;

    public constructor(
        private readonly locks: ModelLocks,
        private readonly model: string,
        private readonly tail: Promise<void>,
        private readonly held: ResolvablePromise,
    )
    {
    }

    public dispose(): void
    {
        if (this.released)
        {
            return;
        }
        this.released = true;
        this.held.Resolve();
        this.locks.Forget(this.model, this.tail);
    }
}

/** The leases one commit holds; dispose() releases them, last acquired first. */
class ModelLeases implements IDisposable
{
    public constructor(private readonly leases: readonly ModelLease[])
    {
    }

    public dispose(): void
    {
        for (const lease of [...this.leases].reverse())
        {
            lease.dispose();
        }
    }
}

/**
 * Per-model commit serialization within one connector: a model's check-then-write (and a compensation) runs alone,
 * so a commit whose session opened before another commit wrote the model always sees it stale.
 */
class ModelLocks
{
    private readonly tails = new Map<string, Promise<void>>();

    /** Acquires every model's lock, in the (sorted) order given, so two commits never wait on each other. */
    public async Acquire(models: readonly string[]): Promise<ModelLeases>
    {
        const leases: ModelLease[] = [];
        for (const model of models)
        {
            leases.push(await this.AcquireOne(model));
        }
        return new ModelLeases(leases);
    }

    /** ModelLease: drops the model's entry once no later commit queued behind the released lease. */
    public Forget(model: string, tail: Promise<void>): void
    {
        if (this.tails.get(model) === tail)
        {
            this.tails.delete(model);
        }
    }

    private async AcquireOne(model: string): Promise<ModelLease>
    {
        const prior = this.tails.get(model) ?? Promise.resolve();
        const held = new ResolvablePromise();
        const tail = prior.then(() => held.Promise);
        this.tails.set(model, tail);
        await prior;
        return new ModelLease(this, model, tail, held);
    }
}

enum TransactionState
{
    /** Taking changes; Revert drops the sessions. */
    Open = 1,
    /** Commit is running: neither Apply nor a second Commit may start. */
    Committing,
    /** The files are written; Revert compensates. */
    Committed,
    /** Reverted, or a failed commit already restored: nothing left to undo. */
    Finished,
}

/** One engine write-through into `.todl` files: one draft session per owner model. */
class TodlFileTransaction implements IConnectorTransaction
{
    private static readonly StaleMessage = 'The sources of model "{0}" changed since the write began';
    private static readonly EmitMessage = 'The sources of model "{0}" cannot be written back';
    private static readonly ReadMessage = 'Reading the sources of model "{0}" failed';
    private static readonly WriteMessage = 'Writing the sources of model "{0}" failed';
    private static readonly UnrestoredMessage = '{0}; {1} file(s) could not be restored';
    private static readonly RevertMessage = '{0} file(s) could not be restored';
    private static readonly StateMessage = 'The connector transaction is no longer open';
    private static readonly NotEditableMessage = 'Model "{0}" has no editable sources here';
    private static readonly OwnerSeparator = ', ';

    private readonly sessions = new Map<string, ITodlDraftSession>();
    private readonly written: WrittenFile[] = [];
    private state = TransactionState.Open;
    private committing: Promise<void> | undefined;

    public constructor(private readonly workspace: ITodlModelWorkspace, private readonly locks: ModelLocks)
    {
    }

    public async Apply(changes: ConnectorChangeSet): Promise<void>
    {
        this.RequireOpen();
        for (const change of changes.Changes)
        {
            new TodlDraftEditor(await this.SessionOf(change.Owner)).Apply(change);
        }
    }

    public Commit(): Promise<void>
    {
        if (this.state !== TransactionState.Open)
        {
            return Promise.reject(TodlFileTransaction.Closed());
        }
        this.state = TransactionState.Committing;
        this.committing = this.CommitAll();
        return this.committing;
    }

    public async Revert(): Promise<void>
    {
        if (this.state === TransactionState.Committing)
        {
            // Not something the WriteCoordinator does (it reverts a hung call only once it returns), but compensate
            // whatever the running commit ends up writing rather than race it.
            await this.committing?.catch(() => undefined);
        }
        const committed = this.state === TransactionState.Committed;
        const owners = this.Owners();
        this.state = TransactionState.Finished;
        this.sessions.clear();
        if (!committed)
        {
            return;
        }
        const leases = await this.locks.Acquire(owners);
        try
        {
            const unrestored = await this.RestoreWritten();
            if (unrestored > 0)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.RevertMessage, String(unrestored)));
            }
        }
        finally
        {
            leases.dispose();
        }
    }

    /**
     * Under every owner's lock: emit each model's files and read their originals, then check every model's sources
     * are unchanged (else Stale, nothing written), then write model by model in owner-name order. Any failure
     * restores what was written.
     */
    private async CommitAll(): Promise<void>
    {
        const owners = this.Owners();
        const leases = await this.locks.Acquire(owners);
        try
        {
            const pending: WrittenFile[] = [];
            for (const owner of owners)
            {
                pending.push(...await this.Changed(owner, this.sessions.get(owner)!));
            }
            // Checked after the originals were read: an outside write that landed before a read changes the hash too.
            for (const owner of owners)
            {
                const session = this.sessions.get(owner)!;
                if (await session.CurrentSourceHash() !== session.SourceHash)
                {
                    throw new EngineBridgeError(EngineBridgeErrorCode.Stale, MessageFormat.Format(TodlFileTransaction.StaleMessage, owner));
                }
            }
            for (const file of pending)
            {
                this.written.push(file);
                await TodlFileTransaction.Write(file);
            }
            this.state = TransactionState.Committed;
        }
        catch (error)
        {
            this.state = TransactionState.Finished;
            const unrestored = await this.RestoreWritten();
            const failure = error instanceof EngineBridgeError
                ? error
                : new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.WriteMessage, owners.join(TodlFileTransaction.OwnerSeparator)), error);
            if (unrestored > 0)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.UnrestoredMessage, failure.message, String(unrestored)), failure);
            }
            throw failure;
        }
        finally
        {
            leases.dispose();
        }
    }

    private async SessionOf(owner: string): Promise<ITodlDraftSession>
    {
        let session = this.sessions.get(owner);
        if (session === undefined)
        {
            session = await this.workspace.OpenDraft(owner);
            if (session === undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, MessageFormat.Format(TodlFileTransaction.NotEditableMessage, owner));
            }
            this.sessions.set(owner, session);
        }
        return session;
    }

    /** The model's files whose emitted text differs from what they hold now (new files included), with their originals. */
    private async Changed(owner: string, session: ITodlDraftSession): Promise<WrittenFile[]>
    {
        let targets: [string, string][];
        try
        {
            targets = [...session.Draft.toTodlByFile()];
        }
        catch (error)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.EmitMessage, owner), error);
        }
        const changed: WrittenFile[] = [];
        for (const [uri, text] of targets)
        {
            let original: string | undefined;
            try
            {
                original = await session.ReadFile(uri);
            }
            catch (error)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.ReadMessage, owner), error);
            }
            if (original !== text)
            {
                changed.push(new WrittenFile(owner, session, uri, original, text));
            }
        }
        return changed;
    }

    /**
     * Writes one file (already recorded, so a torn write is restored too); a failure is PersistFailed, caused by it. A
     * session's Stale refusal stays Stale and marks the file refused: it never reached storage, so it is not restored.
     */
    private static async Write(file: WrittenFile): Promise<void>
    {
        try
        {
            await file.Session.WriteFile(file.Uri, file.Written);
            file.Completed = true;
        }
        catch (error)
        {
            if (error instanceof EngineBridgeError && error.Code === EngineBridgeErrorCode.Stale)
            {
                file.Refused = true;
                throw error;
            }
            throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, MessageFormat.Format(TodlFileTransaction.WriteMessage, file.Owner), error);
        }
    }

    /** Restores every written file, last written first; returns how many could not be restored. Empties the record. */
    private async RestoreWritten(): Promise<number>
    {
        let unrestored = 0;
        for (const file of this.written.splice(0).reverse())
        {
            if (!await file.Restore())
            {
                unrestored++;
            }
        }
        return unrestored;
    }

    /** The owners of the sessions, in name order: the commit and lock order. */
    private Owners(): string[]
    {
        return [...this.sessions.keys()].sort();
    }

    private RequireOpen(): void
    {
        if (this.state !== TransactionState.Open)
        {
            throw TodlFileTransaction.Closed();
        }
    }

    private static Closed(): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.TransactionClosed, TodlFileTransaction.StateMessage);
    }
}

/**
 * The engine connector that keeps nodes in `.todl` source files (spec §6, today's DevModelWriter stage / swap /
 * restore as a write-through). Apply opens one draft session per owner model and edits it. Commit, holding every
 * owner model's lock, emits and reads each model's files, checks every model's sources are unchanged since its
 * session opened (else Stale, nothing written), then writes every changed file, model by model in owner-name order;
 * any failure restores what was already written (PersistFailed). Revert before Commit drops the sessions; after
 * Commit it restores every original and deletes the files the commit created, leaving alone a file something else
 * has written since. Commits of one model through one connector run one at a time.
 */
export class TodlFileConnector implements IGraphConnector
{
    public static readonly ConnectorName = TodlNames.FileConnector;

    public readonly Name = TodlFileConnector.ConnectorName;

    private readonly locks = new ModelLocks();

    public constructor(private readonly workspace: ITodlModelWorkspace)
    {
    }

    public Begin(): Promise<IConnectorTransaction>
    {
        return Promise.resolve(new TodlFileTransaction(this.workspace, this.locks));
    }
}
