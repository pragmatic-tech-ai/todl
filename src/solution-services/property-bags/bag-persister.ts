import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime';
import { type BagScope } from './bag-address.js';

// Owns the property bags for one manifest-bearing owner in one scope (a global store, a
// solution, a project's shared manifest, or a project's local sidecar). "Any item with a
// manifest can persist bags." Bags are addressed within the persister by kind + instance id;
// the same kind may hold many instances. Reads are defensive — a missing document/section
// yields no ids and empty bags, never a throw.
export interface IBagPersister
{
    readonly Scope: BagScope;
    // Instance ids of a kind this persister currently holds.
    Ids(kind: string): readonly string[];
    // The value bag for one instance (an empty bag when the instance does not exist yet).
    Bag(kind: string, id: string): IPropertyBag;
    // Create (or return the existing) instance and its bag.
    Create(kind: string, id: string): IPropertyBag;
    // Remove an instance and its bag.
    Delete(kind: string, id: string): void;
}
