import { And, Compare, CompareOp, EdgeDirection, In, Or, Related, type Predicate } from '@pragmatic-tech-ai/graph';
import { type ShareRight, ShareSubject, SystemNames } from './SystemNames.js';

/** Who a reader is for share purposes: the principal and the teams it belongs to. */
export interface IShareSubjects
{
    readonly PrincipalId: string;
    readonly Teams: readonly string[];
}

/**
 * The engine predicates a host ORs into its scopes so shared records become visible (ruling T10). A Related target is
 * decided under the same scope (R66), so a scope using Widening must also make the principal's grants visible: its
 * ShareGrant Rows entry must admit at least GrantRows, or no grant can widen anything.
 */
export class ShareGrantScope
{
    /** The grants addressed to the principal or to one of its teams (the team arm is omitted when there are none). */
    public static SubjectMatch(s: IShareSubjects): Predicate
    {
        const arms: Predicate[] = [ShareGrantScope.Subject(ShareSubject.Principal, new Compare(SystemNames.SubjectId, CompareOp.Eq, s.PrincipalId))];
        if (s.Teams.length > 0)
        {
            arms.push(ShareGrantScope.Subject(ShareSubject.Team, new In(SystemNames.SubjectId, s.Teams)));
        }
        return new Or(arms);
    }

    /** The ShareGrant rows the subjects must be able to see for Widening to work: their own grants. */
    public static GrantRows(s: IShareSubjects): Predicate
    {
        return ShareGrantScope.SubjectMatch(s);
    }

    /** A record is admitted when a visible grant of the subjects with `right` set links it as its record. */
    public static Widening(s: IShareSubjects, right: ShareRight): Predicate
    {
        const grant = new And([ShareGrantScope.SubjectMatch(s), new Compare(right, CompareOp.Eq, true)]);
        return new Related(SystemNames.Record, EdgeDirection.In, grant);
    }

    private static Subject(kind: ShareSubject, id: Predicate): Predicate
    {
        return new And([new Compare(SystemNames.SubjectKind, CompareOp.Eq, kind), id]);
    }
}
