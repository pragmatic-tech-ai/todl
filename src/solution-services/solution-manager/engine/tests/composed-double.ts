import { Signal } from "@pragmatic-tech-ai/todl-runtime";
import type { SolutionManagerService } from "../solution-manager-service.js";
import type { SolutionMember } from "../solution-member.js";

// Test support: a lightweight SolutionManagerService stand-in exposing the composed
// member seam (ComposedMembers / ComposedChanged) over a plain ActiveSolution-shaped
// value, mirroring the real default (composed set == active solution's members).
export class ComposedDouble
{
    public readonly ComposedChanged: Signal<void> = new Signal<void>();

    constructor(public ActiveSolution: { Members: Iterable<SolutionMember> } | undefined)
    {
    }

    public static For(active: { Members: Iterable<unknown> } | undefined): SolutionManagerService
    {
        return new ComposedDouble(active as { Members: Iterable<SolutionMember> } | undefined) as unknown as SolutionManagerService;
    }

    // Must track the real manager's default ComposedMembers (re-implemented here; keep in sync).
    public ComposedMembers(): readonly SolutionMember[]
    {
        return this.ActiveSolution ? Array.from(this.ActiveSolution.Members) : [];
    }
}
