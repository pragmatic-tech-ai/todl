/** The privilege actions (mirrors C1 PrivilegeAction by string value). */
export enum SecurityAction
{
    Create = 'create',
    Read = 'read',
    Update = 'update',
    Delete = 'delete',
    Append = 'append',
    AppendTo = 'appendTo',
    Assign = 'assign',
    Share = 'share',
    Invoke = 'invoke',
}

/** The privilege depths (mirrors C1 AccessLevel by string value). */
export enum SecurityDepth
{
    None = 'none',
    User = 'user',
    BusinessUnit = 'businessUnit',
    BusinessUnitAndChildren = 'businessUnitAndChildren',
    Organization = 'organization',
}

/** The platform base roles a package may contribute to (C4). */
export enum BaseRoleName
{
    SystemAdministrator = 'SystemAdministrator',
    BasicUser = 'BasicUser',
    Reader = 'Reader',
}

/** The rights a field profile can grant on a secured field. */
export enum FieldProfileRight
{
    Read = 'read',
    Update = 'update',
    Create = 'create',
}

/** Maps authored security words to their enum values; an unknown word yields undefined. */
export class SecurityTerms
{
    private constructor()
    {
    }

    public static ActionOf(text: string): SecurityAction | undefined
    {
        return SecurityTerms.Of(SecurityAction, text);
    }

    public static DepthOf(text: string): SecurityDepth | undefined
    {
        return SecurityTerms.Of(SecurityDepth, text);
    }

    /** Exact, case-sensitive. */
    public static BaseRoleOf(text: string): BaseRoleName | undefined
    {
        return SecurityTerms.Of(BaseRoleName, text);
    }

    public static RightOf(text: string): FieldProfileRight | undefined
    {
        return SecurityTerms.Of(FieldProfileRight, text);
    }

    private static Of<T extends string>(values: Record<string, T>, text: string): T | undefined
    {
        return (Object.values(values) as string[]).includes(text) ? (text as T) : undefined;
    }
}
