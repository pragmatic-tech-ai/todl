import { And, Compare, CompareOp, ConceptIs, EdgeDirection, In, Or, Predicate, Related } from '@pragmatic-tech-ai/graph';
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
    /**
     * The grants addressed to the principal or to one of its teams. Fails closed: an empty principal id (an anonymous
     * caller) has no principal arm, empty team ids are ignored, the team arm is omitted when no team is left, and with
     * no arm at all nothing matches.
     */
    public static SubjectMatch(s: IShareSubjects): Predicate
    {
        const arms: Predicate[] = [];
        if (s.PrincipalId.length > 0)
        {
            arms.push(ShareGrantScope.Subject(ShareSubject.Principal, new Compare(SystemNames.SubjectId, CompareOp.Eq, s.PrincipalId)));
        }
        const teams = s.Teams.filter((team) => team.length > 0);
        if (teams.length > 0)
        {
            arms.push(ShareGrantScope.Subject(ShareSubject.Team, new In(SystemNames.SubjectId, teams)));
        }
        return arms.length === 0 ? Predicate.False : new Or(arms);
    }

    /** The ShareGrant rows the subjects must be able to see for Widening to work: their own grants. */
    public static GrantRows(s: IShareSubjects): Predicate
    {
        return ShareGrantScope.SubjectMatch(s);
    }

    /**
     * A record is admitted when a visible grant of the subjects with `right` set links it as its record. The far node
     * must be exactly a ShareGrant: Related follows every incoming `record` edge whatever concept declares it, so
     * without the ConceptIs guard any concept with lookalike members could forge a grant.
     */
    public static Widening(s: IShareSubjects, right: ShareRight): Predicate
    {
        const grant = new And([new ConceptIs(SystemNames.ShareGrant), ShareGrantScope.SubjectMatch(s), new Compare(right, CompareOp.Eq, true)]);
        return new Related(SystemNames.Record, EdgeDirection.In, grant);
    }

    private static Subject(kind: ShareSubject, id: Predicate): Predicate
    {
        return new And([new Compare(SystemNames.SubjectKind, CompareOp.Eq, kind), id]);
    }
}
