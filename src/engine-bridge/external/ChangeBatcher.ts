import { WriteOp, type ConnectorChange, type ConnectorChangeSet, type ILinkOp, type ISetPropertyOp, type IUnlinkOp } from '@pragmatic-tech-ai/graph';
import { WriteOperationKind, type ExternalFieldValue, type WriteBatch, type WriteOperation } from '../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { IExternalBinding } from './ExternalBinding.js';
import type { ExternalIdentity } from './ExternalIdentity.js';
import { ExternalValues } from './ExternalValues.js';
import { MappedMembers } from './FetchTranslator.js';

/** The source write one binding receives for a change set. */
export interface IPendingBatch
{
    readonly Binding: IExternalBinding;
    readonly Batch: WriteBatch;
}

/** What the merged ops on one public id amount to so far. */
enum PendingKind
{
    Upsert = 1,
    Delete,
}

/** The merged write of one public id: an Upsert of the fields set so far, or a Delete. */
class PendingWrite
{
    public Kind = PendingKind.Upsert;
    /** True once the change set created the id (a CreateNode was merged in, possibly after a Delete). */
    public Created = false;
    /** True when the first op on the id was its CreateNode: the node did not exist before the set. */
    public BornHere = false;
    /** True until the first op on the id has merged. */
    public Fresh = true;
    public readonly Fields = new Map<string, ExternalFieldValue>();

    public constructor(public readonly Binding: IExternalBinding, public readonly StorageId: string, public readonly Key: ExternalFieldValue)
    {
    }

    public Operation(): WriteOperation
    {
        return this.Kind === PendingKind.Delete
            ? { Kind: WriteOperationKind.Delete, Key: this.Key, Fields: {} }
            : { Kind: WriteOperationKind.Upsert, Key: this.Key, Fields: Object.fromEntries(this.Fields) };
    }
}

/**
 * Translates the change set an engine transaction hands a DataSourceConnector into source write batches (ruling T9).
 * It only translates and validates; it has no remote effect. The ops on one public id merge in order into one
 * WriteOperation: CreateNode, SetProperty and Link merge into an Upsert (a create also writes its key into IdKey); a
 * DeleteNode makes it a Delete, and a CreateNode then DeleteNode in one set cancels out; an Unlink of a mapped foreign
 * key sets it to null, unless the set already re-pointed the key at another target. There is one WriteBatch per binding,
 * in order of first appearance, its operations in order of first appearance of their ids.
 *
 * A change it cannot express throws: a public id that is not one of `connector`'s (ForeignId), a binding that is not
 * Writable (NotWritable), and as UnsupportedExternalChange a SetOwner, a create of another concept than the binding's,
 * an unmapped member, a change to the id member of a node the set did not create (or a value of it that differs from the
 * minted key), link properties, a temporal value, and any change after a Delete of the same id.
 */
export class ChangeBatcher
{
    private static readonly ErrForeign = 'Not a public id of connector ';
    private static readonly ErrIdSeparator = ': ';
    private static readonly ErrNotWritable = 'The external binding is not writable: ';
    private static readonly ErrSetOwner = 'An external node cannot be re-owned: ';
    private static readonly ErrConcept = 'An external source holds exactly its bound concept; cannot create ';
    private static readonly ErrUnmapped = 'The member is not mapped to a field of the external source: ';
    private static readonly ErrIdMember = 'The id member of an existing external node cannot change: ';
    private static readonly ErrIdValue = 'The id member of an external create must equal its key: ';
    private static readonly ErrLinkProperties = 'An external foreign key cannot carry link properties: ';
    private static readonly ErrAfterDelete = 'An external node cannot be changed after it was deleted: ';
    private static readonly ErrDuplicate = 'An external node is created twice: ';
    private static readonly MemberSeparator = '.';

    public static Batches(changes: ConnectorChangeSet, identity: ExternalIdentity, connector: string): readonly IPendingBatch[]
    {
        const byBinding = new Map<IExternalBinding, Map<string, PendingWrite>>();
        for (const change of changes.Changes)
        {
            ChangeBatcher.Merge(change, identity, connector, byBinding);
        }
        const batches: IPendingBatch[] = [];
        for (const [binding, writes] of byBinding)
        {
            if (writes.size > 0)
            {
                batches.push({ Binding: binding, Batch: ChangeBatcher.Batch(binding, [...writes.values()].map(w => w.Operation())) });
            }
        }
        return batches;
    }

    private static Batch(binding: IExternalBinding, operations: WriteOperation[]): WriteBatch
    {
        const b = binding.Binding;
        const batch: WriteBatch = { Source: b.Source, IdKey: b.IdKey, Operations: operations, Concurrency: b.Concurrency, Atomicity: b.Atomicity };
        if (b.VersionField !== undefined)
        {
            batch.VersionField = b.VersionField;
        }
        return batch;
    }

    private static Merge(change: ConnectorChange, identity: ExternalIdentity, connector: string, byBinding: Map<IExternalBinding, Map<string, PendingWrite>>): void
    {
        const publicId = change.Op === WriteOp.Link || change.Op === WriteOp.Unlink ? change.From : change.PublicId;
        if (change.Op === WriteOp.SetOwner)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrSetOwner + publicId);
        }
        const parsed = identity.Parse(publicId);
        if (parsed === undefined || parsed.Binding.Connector !== connector)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ForeignId, ChangeBatcher.ErrForeign + connector + ChangeBatcher.ErrIdSeparator + publicId);
        }
        const binding = parsed.Binding;
        if (!binding.Binding.Writable)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotWritable, ChangeBatcher.ErrNotWritable + publicId);
        }
        let writes = byBinding.get(binding);
        if (writes === undefined)
        {
            writes = new Map();
            byBinding.set(binding, writes);
        }
        let write = writes.get(publicId);
        if (write === undefined)
        {
            write = new PendingWrite(binding, parsed.StorageId, identity.StorageKey(binding, parsed.StorageId));
            writes.set(publicId, write);
        }
        ChangeBatcher.MergeInto(write, writes, change, publicId, identity);
        write.Fresh = false;
    }

    private static MergeInto(write: PendingWrite, writes: Map<string, PendingWrite>, change: ConnectorChange, publicId: string, identity: ExternalIdentity): void
    {
        switch (change.Op)
        {
            case WriteOp.CreateNode:
                ChangeBatcher.Create(write, change.Concept, publicId);
                return;
            case WriteOp.DeleteNode:
                if (write.BornHere)
                {
                    writes.delete(publicId);
                    return;
                }
                write.Kind = PendingKind.Delete;
                write.Created = false;
                write.Fields.clear();
                return;
            default:
                if (write.Kind === PendingKind.Delete)
                {
                    throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrAfterDelete + publicId);
                }
                if (change.Op === WriteOp.SetProperty)
                {
                    ChangeBatcher.SetProperty(write, change, identity);
                }
                else if (change.Op === WriteOp.Link || change.Op === WriteOp.Unlink)
                {
                    ChangeBatcher.Relink(write, change, identity);
                }
        }
    }

    private static Create(write: PendingWrite, concept: string, publicId: string): void
    {
        if (concept !== write.Binding.Binding.Concept)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrConcept + concept + ChangeBatcher.ErrIdSeparator + publicId);
        }
        if (write.Created)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrDuplicate + publicId);
        }
        // A create as the first op on the id is a new row; a create after a Delete replaces the row the set deleted.
        write.BornHere = write.Fresh;
        write.Kind = PendingKind.Upsert;
        write.Created = true;
        write.Fields.clear();
        write.Fields.set(write.Binding.Binding.IdKey, write.Key);
    }

    private static SetProperty(write: PendingWrite, op: ISetPropertyOp, identity: ExternalIdentity): void
    {
        const binding = write.Binding;
        const subject = op.PublicId + ChangeBatcher.MemberSeparator + op.Member;
        if (op.Member === identity.IdMemberName(binding))
        {
            if (!write.Created)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrIdMember + subject);
            }
            const value = op.Value === null ? null : ExternalValues.ToExternal(op.Value, subject);
            if (value === null || String(value) !== write.StorageId)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrIdValue + subject);
            }
            return;
        }
        const property = MappedMembers.Property(binding, op.Member, identity);
        if (property === undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrUnmapped + subject);
        }
        write.Fields.set(property.Field, op.Value === null ? null : ExternalValues.ToExternal(op.Value, subject));
    }

    private static Relink(write: PendingWrite, op: ILinkOp | IUnlinkOp, identity: ExternalIdentity): void
    {
        const binding = write.Binding;
        const subject = op.From + ChangeBatcher.MemberSeparator + op.Relationship;
        const field = MappedMembers.Link(binding, op.Relationship, identity);
        if (field === undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrUnmapped + subject);
        }
        const key = identity.ForeignKey(binding, op.Relationship, op.To);
        if (op.Op === WriteOp.Link)
        {
            if (op.Options?.Properties !== undefined && op.Options.Properties.size > 0)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ChangeBatcher.ErrLinkProperties + subject);
            }
            write.Fields.set(field, key);
            return;
        }
        // An Unlink clears the key only when it still points at the unlinked target (or the set has not written it).
        if (!write.Fields.has(field) || write.Fields.get(field) === key)
        {
            write.Fields.set(field, null);
        }
    }
}
