import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import { type SolutionMember } from './solution-member.js';
import { type SolutionManagerService } from './solution-manager-service.js';

// The set of members whose source composes into one language-service graph. The
// default is the manager's single active solution; a host (e.g. a multi-solution
// server) may supply a provider that unions several solutions.
export interface IComposedMemberSet
{
    Members(): readonly SolutionMember[];
    readonly Changed: Signal<void>;
}

// Default provider: exactly the active solution's members, changing whenever the
// manager's ActiveSolution changes.
export class DefaultComposedMemberSet implements IComposedMemberSet
{
    private static readonly ActiveSolutionName = 'ActiveSolution';

    public readonly Changed: Signal<void> = new Signal<void>();

    constructor(private readonly manager: SolutionManagerService)
    {
        manager
            .PropertyChanged(DefaultComposedMemberSet.ActiveSolutionName)
            .subscribe(() => this.Changed.emit());
    }

    public Members(): readonly SolutionMember[]
    {
        const active = this.manager.ActiveSolution;
        return active ? active.Members.ToArray() : [];
    }
}
