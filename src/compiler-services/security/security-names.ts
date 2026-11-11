/**
 * The names of the `todl.system` security foundation: the system package identity and the `Owned` aspect with its
 * system-maintained fields. The compiler's source of truth; engine-bridge `SystemNames` derives from it.
 */
export class SecurityNames
{
    /** The system package's model id. */
    public static readonly SystemModel = 'todl.system';
    /** The system package's version. */
    public static readonly SystemVersion = '1.0.0';
    /** The aspect a concept takes to be owned by a principal and a business unit. */
    public static readonly OwnedAspect = 'todl.system.Owned';
    /** Owned property: the owning principal id. */
    public static readonly Owner = 'owner';
    /** Owned property: the owning business unit id. */
    public static readonly OwningBusinessUnit = 'owningBusinessUnit';
    /** The fields the engine bridge, not the package, maintains. */
    public static readonly SystemFields: ReadonlySet<string> = new Set([SecurityNames.Owner, SecurityNames.OwningBusinessUnit]);

    private constructor()
    {
    }

    /** Is `member` a system-maintained field? */
    public static IsSystemField(member: string): boolean
    {
        return SecurityNames.SystemFields.has(member);
    }
}
