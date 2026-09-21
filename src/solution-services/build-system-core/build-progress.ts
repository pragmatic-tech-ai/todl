import type { BuildDiagnostic } from "./diagnostic-sink.js";
import type { ActionStatus, ProjectBuildStatus, ProjectId } from "./build-result.js";

// The push observer the framework emits progress through (spec §10.1). Hierarchical
// determinate milestones over the solution -> project -> action tree. A single-
// project build emits Project*/Action* only (no SolutionStarted). Plexus adapts this
// to the Background Work dock / a build-panel VM; TODL depends only on the interface.
export interface IBuildProgress
{
    SolutionStarted(order: readonly ProjectId[]): void;
    ProjectStarted(id: ProjectId, actions: readonly string[]): void;
    ActionStarted(project: ProjectId, action: string): void;
    ActionFinished(project: ProjectId, action: string, status: ActionStatus): void;
    ProjectFinished(id: ProjectId, status: ProjectBuildStatus): void;
    Diagnostic(project: ProjectId, diagnostic: BuildDiagnostic): void;
}

// The default observer for headless and test callers that don't render progress.
export class NoOpBuildProgress implements IBuildProgress
{
    public SolutionStarted(): void {}
    public ProjectStarted(): void {}
    public ActionStarted(): void {}
    public ActionFinished(): void {}
    public ProjectFinished(): void {}
    public Diagnostic(): void {}
}
