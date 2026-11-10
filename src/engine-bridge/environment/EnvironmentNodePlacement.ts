import { randomUUID } from 'node:crypto';
import type { CellValue, Cypher } from '@pragmatic-tech-ai/graph';
import type { IExternalBinding } from '../external/ExternalBinding.js';
import type { ExternalIdentity } from '../external/ExternalIdentity.js';

/**
 * Places the nodes a Cypher CREATE / MERGE makes in an environment (ruling T8). A concept with an external binding
 * is created in that source: public id minted from the id member's value (else a fresh key), owner the binding's
 * model. Every other create is an engine node with a random id owned by the concept's home model.
 */
export class EnvironmentNodePlacement implements Cypher.INodePlacement
{
    private static readonly NoOwner = '';
    /** A decimal-text probe: StorageKey returns a number for it only when the binding's id member is numeric. */
    private static readonly NumericProbe = '0';

    public constructor(
        private readonly identity: ExternalIdentity,
        private readonly homeModels: ReadonlyMap<string, string>,
        private readonly ids: () => string = randomUUID,
    )
    {
    }

    public Place(concept: string, properties: ReadonlyMap<string, CellValue>): ReturnType<Cypher.INodePlacement['Place']>
    {
        const binding = this.identity.CreateTarget(concept);
        if (binding === undefined)
        {
            return { PublicId: this.ids(), Owner: this.homeModels.get(concept) ?? EnvironmentNodePlacement.NoOwner };
        }
        const idMember = EnvironmentNodePlacement.IdMember(binding);
        const value = idMember === undefined ? undefined : properties.get(idMember);
        if (value !== undefined && value !== null)
        {
            return { PublicId: this.identity.Mint(binding, String(value)), Owner: binding.Model };
        }
        const key = this.ids();
        const publicId = this.identity.Mint(binding, key);
        if (idMember === undefined || typeof this.identity.StorageKey(binding, EnvironmentNodePlacement.NumericProbe) === 'number')
        {
            return { PublicId: publicId, Owner: binding.Model };
        }
        return { PublicId: publicId, Owner: binding.Model, Defaults: new Map<string, CellValue>([[idMember, key]]) };
    }

    /** The member mapped to the source's id field. */
    private static IdMember(binding: IExternalBinding): string | undefined
    {
        return Object.entries(binding.Binding.FieldMap).find(([, field]) => field === binding.Binding.IdKey)?.[0];
    }
}
