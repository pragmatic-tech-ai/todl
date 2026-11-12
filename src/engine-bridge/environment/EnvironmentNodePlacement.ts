import { randomUUID } from 'node:crypto';
import { ValueType, type CellValue, type Cypher } from '@pragmatic-tech-ai/graph';
import { KeyAssignment } from '../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { ExternalIdentity } from '../external/ExternalIdentity.js';
import { MessageFormat } from '../MessageFormat.js';
import type { IPrincipalFacts } from '../PrincipalFacts.js';
import { SystemNames } from '../system/SystemNames.js';

/**
 * Places the nodes a Cypher CREATE / MERGE makes in an environment (ruling T8). A concept with an external binding
 * is created in that source: public id minted from the id member's value (else a fresh key), owner the binding's
 * model. Every other create is an engine node with a random id owned by the concept's home model; when its concept is
 * owned (todl.system.Owned, directly or through a parent), the placement defaults its owner to the acting principal and
 * its owning business unit to the principal's home unit (spec C3), and refuses a create that sets either itself
 * (SystemFieldWrite, whatever the scope). External concepts are never owned (the composer rejects them).
 */
export class EnvironmentNodePlacement implements Cypher.INodePlacement
{
    private static readonly ErrNoHomeModel = 'No home model is known for concept ';
    private static readonly ErrBadId = 'The id member of an external create must be a non-empty string, a bigint or a finite number: ';
    private static readonly EmptyText = '';
    private static readonly ErrSystemField = 'A create of owned concept {0} may not set system field {1}; the engine places it';

    public constructor(
        private readonly identity: ExternalIdentity,
        private readonly homeModels: ReadonlyMap<string, string>,
        private readonly owned: ReadonlySet<string>,
        private readonly principal: IPrincipalFacts,
        private readonly ids: () => string = randomUUID,
    )
    {
    }

    public Place(concept: string, properties: ReadonlyMap<string, CellValue>): Cypher.INodePlace
    {
        const binding = this.identity.CreateTarget(concept);
        if (binding === undefined)
        {
            const owner = this.homeModels.get(concept);
            if (owner === undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.NoHomeModel, EnvironmentNodePlacement.ErrNoHomeModel + concept);
            }
            if (!this.owned.has(concept))
            {
                return { PublicId: this.ids(), Owner: owner };
            }
            EnvironmentNodePlacement.RejectSystemFields(concept, properties);
            return { PublicId: this.ids(), Owner: owner, Defaults: this.OwnedDefaults() };
        }
        const idMember = this.identity.IdMemberName(binding);
        const value = idMember === undefined ? undefined : properties.get(idMember);
        if (value !== undefined && value !== null)
        {
            // An explicit key is the caller's choice: mint it as today, whoever assigns keys for the binding.
            return { PublicId: this.identity.Mint(binding, EnvironmentNodePlacement.IdText(concept, value)), Owner: binding.Model };
        }
        if (ExternalIdentity.KeyAssignmentOf(binding) === KeyAssignment.Source)
        {
            // The source assigns the key (ruling R139 E9): CREATE goes through CreateAssigned, so no id is minted here.
            return { PublicId: EnvironmentNodePlacement.EmptyText, Owner: binding.Model, KeyAssigned: true };
        }
        const key = this.ids();
        const publicId = this.identity.Mint(binding, key);
        // Only a text id member can hold the minted key; a numeric one cannot (Q3), and an unmapped one has none.
        if (idMember !== undefined && this.identity.IdMemberType(binding) === ValueType.String)
        {
            return { PublicId: publicId, Owner: binding.Model, Defaults: new Map<string, CellValue>([[idMember, key]]) };
        }
        return { PublicId: publicId, Owner: binding.Model };
    }

    private OwnedDefaults(): ReadonlyMap<string, CellValue>
    {
        return new Map<string, CellValue>([
            [SystemNames.Owner, this.principal.Id],
            [SystemNames.OwningBusinessUnit, this.principal.HomeBusinessUnitId],
        ]);
    }

    private static RejectSystemFields(concept: string, properties: ReadonlyMap<string, CellValue>): void
    {
        const field = [...SystemNames.SystemFields].find((f) => properties.has(f));
        if (field !== undefined)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.SystemFieldWrite, MessageFormat.Format(EnvironmentNodePlacement.ErrSystemField, concept, field));
        }
    }

    private static IdText(concept: string, value: CellValue): string
    {
        if (typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value !== EnvironmentNodePlacement.EmptyText))
        {
            return String(value);
        }
        throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, EnvironmentNodePlacement.ErrBadId + concept);
    }
}
