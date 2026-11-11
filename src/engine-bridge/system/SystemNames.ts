import { SecurityNames } from '../../compiler-services/security/security-names.js';

/** Names of the `todl.system` package (ruling T10): its identity, the Owned aspect and the share-grant concept's members. */
export class SystemNames
{
    /** The system package's model id. */
    public static readonly Model = SecurityNames.SystemModel;
    /** The system package's version. */
    public static readonly Version = SecurityNames.SystemVersion;
    /** The aspect of a record owned by a principal and a business unit. */
    public static readonly Owned = SecurityNames.OwnedAspect;
    /** Owned property: the owning principal id. */
    public static readonly Owner = SecurityNames.Owner;
    /** Owned property: the owning business unit id. */
    public static readonly OwningBusinessUnit = SecurityNames.OwningBusinessUnit;
    /** Both Owned system fields (owner, owningBusinessUnit). */
    public static readonly SystemFields: ReadonlySet<string> = SecurityNames.SystemFields;
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
