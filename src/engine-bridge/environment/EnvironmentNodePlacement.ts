import { randomUUID } from 'node:crypto';
import { ValueType, type CellValue, type Cypher } from '@pragmatic-tech-ai/graph';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { ExternalIdentity } from '../external/ExternalIdentity.js';

/**
 * Places the nodes a Cypher CREATE / MERGE makes in an environment (ruling T8). A concept with an external binding
 * is created in that source: public id minted from the id member's value (else a fresh key), owner the binding's
 * model. Every other create is an engine node with a random id owned by the concept's home model.
 */
export class EnvironmentNodePlacement implements Cypher.INodePlacement
{
    private static readonly ErrNoHomeModel = 'No home model is known for concept ';
    private static readonly ErrBadId = 'The id member of an external create must be a non-empty string, a bigint or a finite number: ';
    private static readonly EmptyText = '';

    public constructor(
        private readonly identity: ExternalIdentity,
        private readonly homeModels: ReadonlyMap<string, string>,
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
            return { PublicId: this.ids(), Owner: owner };
        }
        const idMember = this.identity.IdMemberName(binding);
        const value = idMember === undefined ? undefined : properties.get(idMember);
        if (value !== undefined && value !== null)
        {
            return { PublicId: this.identity.Mint(binding, EnvironmentNodePlacement.IdText(concept, value)), Owner: binding.Model };
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

    private static IdText(concept: string, value: CellValue): string
    {
        if (typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value !== EnvironmentNodePlacement.EmptyText))
        {
            return String(value);
        }
        throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedValue, EnvironmentNodePlacement.ErrBadId + concept);
    }
}
