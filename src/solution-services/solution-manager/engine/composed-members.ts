import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import { type SolutionMember } from './solution-member.js';
import { SolutionManagerService } from './solution-manager-service.js';

// The set of members whose source composes into one language-service graph. The
// default is the manager's single active solution; a host (e.g. a multi-solution
// server) may supply a provider that unions several solutions.
// A registered provider OWNS the full change signal: while it is set, manager-level
// active-solution changes are NOT forwarded to ComposedChanged; only the provider's
// own Changed drives it (plus one emit when the provider is swapped or cleared).
export interface IComposedMemberSet
{
    Members(): readonly SolutionMember[];
    readonly Changed: Signal<void>;
}

// Default provider: exactly the active solution's members, changing whenever the
// manager's ActiveSolution changes.
export class DefaultComposedMemberSet implements IComposedMemberSet
{
    public readonly Changed: Signal<void> = new Signal<void>();

    // The PropertyChanged subscription is never disposed: it shares the manager's lifetime.
    constructor(private readonly manager: SolutionManagerService)
    {
        manager
            .PropertyChanged(SolutionManagerService.ActiveSolutionChangeName)
            .subscribe(() => this.Changed.emit());
    }

    public Members(): readonly SolutionMember[]
    {
        const active = this.manager.ActiveSolution;
        return active ? active.Members.ToArray() : [];
    }
}
