/** Names of the `todl.system` package (ruling T10): its identity and the share-grant concept's members. */
export class SystemNames
{
    /** The system package's model id. */
    public static readonly Model = 'todl.system';
    /** The system package's version. */
    public static readonly Version = '1.0.0';
    /** The concept of one share of one record with one subject. */
    public static readonly ShareGrant = 'todl.system.ShareGrant';
    /** ShareGrant relationship: the shared record (any element; an external record is linked through its stub). */
    public static readonly Record = 'record';
    /** ShareGrant property: the subject's kind, a ShareSubject value. */
    public static readonly SubjectKind = 'subjectKind';
    /** ShareGrant property: the principal id or team id the grant is to. */
    public static readonly SubjectId = 'subjectId';
}

/** Who a share is to; the values equal the protocol's ShareSubjectKind. */
export enum ShareSubject
{
    Principal = 'principal',
    Team = 'team',
}

/** A right a share grants; each value is the name of the ShareGrant boolean member that holds it. */
export enum ShareRight
{
    Read = 'read',
    Update = 'update',
    Delete = 'delete',
    Assign = 'assign',
    Share = 'share',
}
