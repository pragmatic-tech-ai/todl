import {
    WriteOp,
    type CellValue,
    type ConnectorChange,
    type ConnectorChangeSet,
    type IConnectorTransaction,
    type IGraphConnector,
} from '@pragmatic-tech-ai/graph';
import { MetaKind } from '../compiler-services/model/kinds.js';
import type { Scalar } from '../compiler-services/model/graph.js';
import { Cardinality } from '../manifest/enums.js';
import { EngineBridgeError, EngineBridgeErrorCode } from './EngineBridgeError.js';
import type { ITodlDraftSession, ITodlModelWorkspace } from './TodlModelWorkspace.js';
import { TodlNames } from './TodlNames.js';

/** Engine cell → TODL scalar: strings and booleans as is, finite numbers, bigints that are safe integers. */
class TodlValueConverter
{
    private static readonly UnsupportedMessage = 'Member "{0}" of "{1}" cannot hold this value in a .todl file';
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly MinSafe = BigInt(Number.MIN_SAFE_INTEGER);
    private static readonly MaxSafe = BigInt(Number.MAX_SAFE_INTEGER);

    /** The scalar to write, or null to remove the field. */
    public static ToScalar(id: string, member: string, value: CellValue): Scalar | null
    {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
        {
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value))
        {
            return value;
        }
        if (typeof value === 'bigint' && value >= TodlValueConverter.MinSafe && value <= TodlValueConverter.MaxSafe)
        {
            return Number(value);
        }
        // NaN / Infinity, unsafe bigints, DateValue / DateTimeValue / DurationValue: no .todl literal holds them.
        throw TodlValueConverter.Unsupported(id, member);
    }

    public static Unsupported(id: string, member: string): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, TodlValueConverter.Format(TodlValueConverter.UnsupportedMessage, member, id));
    }

    public static Format(template: string, ...args: string[]): string
    {
        return template.replace(TodlValueConverter.Placeholder, (_, index: string) => args[Number(index)] ?? '');
    }
}

/** Applies engine changes to one model's draft session (spec §6): the engine ops as ModelDraft edits. */
class TodlDraftEditor
{
    private static readonly IdSeparator = '.';
    private static readonly LocalIdPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    private static readonly ForeignMessage = 'Node "{0}" is not an id of namespace "{1}"';
    private static readonly ExistsMessage = 'Node "{0}" already exists in the model\'s sources';
    private static readonly RejectedMessage = 'The model\'s sources cannot take this write: {0}';
    private static readonly EdgeOptionsMessage = 'Link "{0}" of "{1}" carries placement or properties, which .todl references cannot hold';
    private static readonly ClassMessage = 'Member "{0}" of "{1}" is read-only';
    private static readonly NotOwnMessage = 'no own instance "{0}"';

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
                    throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, TodlValueConverter.Format(TodlDraftEditor.EdgeOptionsMessage, change.Relationship, change.From));
                }
                this.Edit(() => this.session.Draft.addRef(change.From, change.Relationship, change.To));
                break;
            case WriteOp.Unlink:
                this.Edit(() =>
                {
                    this.RequireOwn(change.From);
                    this.session.Draft.removeRef(change.From, change.Relationship, change.To);
                });
                break;
            case WriteOp.DeleteNode:
                this.Edit(() => this.RemoveOwn(change.PublicId));
                break;
        }
    }

    private Create(id: string, concept: string): void
    {
        const prefix = this.session.Namespace + TodlDraftEditor.IdSeparator;
        const local = id.startsWith(prefix) ? id.slice(prefix.length) : '';
        if (!TodlDraftEditor.LocalIdPattern.test(local))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ForeignId, TodlValueConverter.Format(TodlDraftEditor.ForeignMessage, id, this.session.Namespace));
        }
        if (this.session.Draft.has(id))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, TodlValueConverter.Format(TodlDraftEditor.ExistsMessage, id));
        }
        // The draft keys instances by their full id (`ns.local`, as loaded); the emitter writes the local part.
        this.Edit(() => this.session.Draft.create(concept, id));
    }

    private Set(id: string, member: string, value: CellValue): void
    {
        if (member === TodlNames.Class)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, TodlValueConverter.Format(TodlDraftEditor.ClassMessage, member, id));
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
            this.Edit(() =>
            {
                this.RequireOwn(id);
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

    private RemoveOwn(id: string): void
    {
        this.RequireOwn(id);
        this.session.Draft.remove(id);
    }

    /** ModelDraft.remove / removeRef are silent for an id the draft does not own; a write to such a node is not editable. */
    private RequireOwn(id: string): void
    {
        if (!this.session.Draft.Owns(id))
        {
            throw new Error(TodlValueConverter.Format(TodlDraftEditor.NotOwnMessage, id));
        }
    }

    /** Runs a draft edit; a draft refusal (frozen or unknown node, missing target) is NotEditable. */
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
            throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, TodlValueConverter.Format(TodlDraftEditor.RejectedMessage, reason));
        }
    }
}

/** One file a commit wrote: what it held before and what the commit put there. Original undefined: it was created. */
class WrittenFile
{
    public constructor(
        public readonly Session: ITodlDraftSession,
        public readonly Uri: string,
        public readonly Original: string | undefined,
        public readonly Written: string,
    )
    {
    }

    /**
     * Puts the original back. True when the file now holds its original; false when something else wrote it since
     * (it is left alone: compensating would destroy that write) or restoring failed.
     */
    public async Restore(): Promise<boolean>
    {
        try
        {
            const current = await this.Session.ReadFile(this.Uri);
            if (current === this.Original)
            {
                return true;
            }
            if (current !== this.Written)
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

/** A held per-model commit lock; Release lets the next commit of the model in. */
class ModelLease
{
    public constructor(private readonly release: () => void)
    {
    }

    public Release(): void
    {
        this.release();
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
    public async Acquire(models: readonly string[]): Promise<ModelLease[]>
    {
        const leases: ModelLease[] = [];
        for (const model of models)
        {
            leases.push(await this.AcquireOne(model));
        }
        return leases;
    }

    public static ReleaseAll(leases: readonly ModelLease[]): void
    {
        for (const lease of [...leases].reverse())
        {
            lease.Release();
        }
    }

    private async AcquireOne(model: string): Promise<ModelLease>
    {
        const prior = this.tails.get(model) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const tail = prior.then(() => held);
        this.tails.set(model, tail);
        await prior;
        return new ModelLease(() =>
        {
            release();
            if (this.tails.get(model) === tail)
            {
                this.tails.delete(model);
            }
        });
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
    private static readonly WriteMessage = 'Writing the sources of model "{0}" failed';
    private static readonly UnrestoredMessage = '{0}; {1} file(s) could not be restored';
    private static readonly RevertMessage = '{0} file(s) could not be restored';
    private static readonly StateMessage = 'The connector transaction is no longer open';
    private static readonly OwnerSeparator = ', ';
    private static readonly NotEditableMessage = 'Model "{0}" has no editable sources here';

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
        this.RequireOpen();
        this.state = TransactionState.Committing;
        this.committing = this.Committed();
        return this.committing;
    }

    private async Committed(): Promise<void>
    {
        const owners = this.Owners();
        const leases = await this.locks.Acquire(owners);
        try
        {
            for (const owner of owners)
            {
                await this.Persist(owner, this.sessions.get(owner)!);
            }
            this.state = TransactionState.Committed;
        }
        catch (error)
        {
            this.state = TransactionState.Finished;
            const unrestored = await this.RestoreWritten();
            const failure = error instanceof EngineBridgeError
                ? error
                : new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, TodlValueConverter.Format(TodlFileTransaction.WriteMessage, owners.join(TodlFileTransaction.OwnerSeparator)));
            if (unrestored > 0)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, TodlValueConverter.Format(TodlFileTransaction.UnrestoredMessage, failure.message, String(unrestored)));
            }
            throw failure;
        }
        finally
        {
            ModelLocks.ReleaseAll(leases);
        }
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
                throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, TodlValueConverter.Format(TodlFileTransaction.RevertMessage, String(unrestored)));
            }
        }
        finally
        {
            ModelLocks.ReleaseAll(leases);
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
                throw new EngineBridgeError(EngineBridgeErrorCode.NotEditable, TodlValueConverter.Format(TodlFileTransaction.NotEditableMessage, owner));
            }
            this.sessions.set(owner, session);
        }
        return session;
    }

    /** Stale check, then every changed file written (new ones created), each recorded before it is written. */
    private async Persist(owner: string, session: ITodlDraftSession): Promise<void>
    {
        if (await session.CurrentSourceHash() !== session.SourceHash)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.Stale, TodlValueConverter.Format(TodlFileTransaction.StaleMessage, owner));
        }
        let targets: [string, string][];
        try
        {
            targets = [...session.Draft.toTodlByFile()];
        }
        catch
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, TodlValueConverter.Format(TodlFileTransaction.EmitMessage, owner));
        }
        try
        {
            for (const [uri, text] of targets)
            {
                const original = await session.ReadFile(uri);
                if (original === text)
                {
                    continue;
                }
                this.written.push(new WrittenFile(session, uri, original, text));
                await session.WriteFile(uri, text);
            }
        }
        catch
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.PersistFailed, TodlValueConverter.Format(TodlFileTransaction.WriteMessage, owner));
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
            throw new Error(TodlFileTransaction.StateMessage);
        }
    }
}

/**
 * The engine connector that keeps nodes in `.todl` source files (spec §6, today's DevModelWriter stage / swap /
 * restore as a write-through). Apply opens one draft session per owner model and edits it; Commit checks each model's
 * sources are unchanged since its session opened (else Stale), then writes every changed file, model by model in
 * owner-name order; any failure restores what was already written (PersistFailed). Revert before Commit drops the
 * sessions; after Commit it restores every original and deletes the files the commit created, leaving alone a file
 * something else has written since. Commits of one model through one connector run one at a time.
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
