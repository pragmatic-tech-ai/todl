import { type SolutionMember } from '../../solution-manager/engine/solution-member.js';

// Seam the host (UI) implements so content mutations never orphan open editors.
// The engine calls it around disk operations; it owns no prompts or tab logic itself.
export interface IContentLifecycleGuard
{
    // Asked before a delete touches disk; false vetoes (the UI may prompt / close tabs here).
    CanRemove(member: SolutionMember, paths: readonly string[]): Promise<boolean>;
    // A path (file or folder subtree) was renamed/moved on disk.
    OnMoved(member: SolutionMember, from: string, to: string): void;
    // Paths were deleted from disk.
    OnRemoved(member: SolutionMember, paths: readonly string[]): void;
}
