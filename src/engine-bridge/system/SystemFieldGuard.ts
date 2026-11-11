import { AccessScope, type IReadOnlyMembers, type IWriteRules } from '@pragmatic-tech-ai/graph';
import { SystemNames } from './SystemNames.js';

/**
 * Makes the Owned system fields (owner, owningBusinessUnit) read-only in a runtime scope (spec C3). Only placement
 * defaults may write them on create (they are exempt from ReadOnly, ruling R91); every later change goes through the
 * assign path, which runs unguarded. Applies to every runtime scope, the System Administrator's included (PR1).
 *
 * Contract: a raw AccessScope.System lets any Cypher SET rewrite owner/owningBusinessUnit (including a SET trailing a
 * CREATE or MERGE, which placement never sees), so hosts MUST open every runtime read-write transaction under
 * Guard(scope). Only OwnershipAssignment's assign path runs unguarded (PR1/PR2).
 */
export class SystemFieldGuard
{
    /**
     * `scope` with owner/owningBusinessUnit read-only (Create and Update stages) on todl.system.Owned; every other rule and the Endpoints unchanged.
     * Precondition: the scope opens on a catalog containing todl.system.Owned (every composed environment has it through the
     * system package; ScopeValidator rejects the scope otherwise).
     */
    public static Guard(scope: AccessScope): AccessScope
    {
        const writes = new Map<string, IWriteRules>(scope.Writes);
        const existing = writes.get(SystemNames.Owned);
        const readOnly: IReadOnlyMembers = {
            Create: SystemFieldGuard.Union(existing?.ReadOnly?.Create),
            Update: SystemFieldGuard.Union(existing?.ReadOnly?.Update),
        };
        // The spread keeps every other rule of the Owned entry (Create/Update/Delete, Append/AppendTo, ReadOnlyExact).
        writes.set(SystemNames.Owned, { ...existing, ReadOnly: readOnly });
        // AccessScope exposes no options object to copy whole, so the scope is rebuilt from every IAccessScopeOptions
        // field (engine 0.4.0); an option a later engine adds must be carried here too, or the guard drops it.
        return AccessScope.Build({
            Default: scope.Default,
            Rows: scope.Rows,
            Hidden: scope.Hidden,
            HiddenExact: scope.HiddenExact,
            Writes: writes,
            Endpoints: scope.Endpoints,
        });
    }

    /** `members` plus the system fields. */
    private static Union(members: ReadonlySet<string> | undefined): ReadonlySet<string>
    {
        return new Set([...(members ?? []), ...SystemNames.SystemFields]);
    }
}
