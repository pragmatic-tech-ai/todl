import { AccessScope, type IReadOnlyMembers, type IWriteRules } from '@pragmatic-tech-ai/graph';
import { SystemNames } from './SystemNames.js';

/**
 * Makes the Owned system fields (owner, owningBusinessUnit) read-only in a runtime scope (spec C3). Only placement
 * defaults may write them on create (they are exempt from ReadOnly, ruling R91); every later change goes through the
 * assign path, which runs unguarded. Applies to every runtime scope, the System Administrator's included (PR1).
 */
export class SystemFieldGuard
{
    private static readonly Fields: readonly string[] = [SystemNames.Owner, SystemNames.OwningBusinessUnit];

    /** `scope` with owner/owningBusinessUnit read-only (Create and Update stages) on todl.system.Owned; every other rule unchanged. */
    public static Guard(scope: AccessScope): AccessScope
    {
        const writes = new Map<string, IWriteRules>(scope.Writes);
        const existing = writes.get(SystemNames.Owned);
        const readOnly: IReadOnlyMembers = {
            Create: SystemFieldGuard.Union(existing?.ReadOnly?.Create),
            Update: SystemFieldGuard.Union(existing?.ReadOnly?.Update),
        };
        writes.set(SystemNames.Owned, { ...existing, ReadOnly: readOnly });
        return AccessScope.Build({ Default: scope.Default, Rows: scope.Rows, Hidden: scope.Hidden, HiddenExact: scope.HiddenExact, Writes: writes });
    }

    /** `members` plus the system fields. */
    private static Union(members: ReadonlySet<string> | undefined): ReadonlySet<string>
    {
        return new Set([...(members ?? []), ...SystemFieldGuard.Fields]);
    }
}
