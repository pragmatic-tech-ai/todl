import { type Signal, type PropertyChangedEventArgs, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { type Solution } from './solution.js';
import { type SolutionMember } from './solution-member.js';
import { type BagVantage } from '../../property-bags/bag-catalog.js';
import { type IBagPersister } from '../../property-bags/bag-persister.js';

// The consumed surface of the solution manager: what a UI / app layer reads off the
// manager facade. Declared as an interface so a non-local (remote) manager can stand
// in for the concrete SolutionManagerService.
// MIRRORS the concrete class's signatures; keep in lockstep (`implements` catches drift).
export interface IManager
{
    // The one active solution, or undefined when none is open.
    readonly ActiveSolution: Solution | undefined;

    // The INPC change channel for a named property (e.g. 'ActiveSolution').
    PropertyChanged(name: string): Signal<PropertyChangedEventArgs>;

    // Persists the active solution.
    Save(): Promise<void>;

    // Opens a project folder as a member of the active solution.
    OpenProject(location: string): Promise<SolutionMember>;

    // Closes a member project.
    CloseProject(member: SolutionMember): Promise<void>;

    // The bag vantage for connection resolution (global + solution + optional member scopes).
    BuildVantage(global: IBagPersister | undefined, member?: SolutionMember, storage?: IStorage): Promise<BagVantage | undefined>;

    // The members whose source compose into one graph.
    ComposedMembers(): readonly SolutionMember[];

    // Raised when the composed member set changes.
    readonly ComposedChanged: Signal<void>;
}
