import type { GraphTransaction } from '@pragmatic-tech-ai/graph';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { SystemNames } from './SystemNames.js';

/** The new owner of a record: a principal id or a team id, with the business unit it belongs to. */
export interface IOwnerAssignment
{
    /** The new owner: a principal id or a team id (spec 4.4). */
    readonly OwnerId: string;
    /** The owner's home BU, or the team's BU. The caller (S3/S4) resolves it from the environment setting. */
    readonly BusinessUnitId: string;
}

/** The only writer of a record's owner and owning business unit. */
export class OwnershipAssignment
{
    private static readonly InvisibleMessage = 'Assign: the record does not exist or is not visible to the caller.';
    private static readonly NotOwnedMessage = 'Assign: the concept of the record is not an owned concept.';
    private static readonly EmptyMessage = 'Assign: the owner id and the business unit id must be non-empty.';

    public constructor(private readonly owned: ReadonlySet<string>)
    {
    }

    /**
     * Records the only write that changes a record's owner/owningBusinessUnit. The caller opens `transaction` under the
     * assign scope, never under SystemFieldGuard: S3's `Tier1ScopeCompiler.CompileAssign` (program ruling PR2: Update gated
     * by the assign privilege, system fields writable), which S4 confines to the system fields with M2.3's `AssignScope`.
     */
    public async Assign(transaction: GraphTransaction, record: string, owner: IOwnerAssignment): Promise<void>
    {
        const concept = await transaction.ConceptOf(record);
        if (concept === undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.InvisibleRecord, OwnershipAssignment.InvisibleMessage);
        }
        if (!this.owned.has(concept))
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.NotOwned, OwnershipAssignment.NotOwnedMessage);
        }
        if (owner.OwnerId === '' || owner.BusinessUnitId === '')
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, OwnershipAssignment.EmptyMessage);
        }
        transaction.SetProperty(record, SystemNames.Owner, owner.OwnerId);
        transaction.SetProperty(record, SystemNames.OwningBusinessUnit, owner.BusinessUnitId);
    }
}
