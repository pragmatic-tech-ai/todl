import type { BuildDiagnostic } from "./diagnostic-sink.js";

export type ProjectId = string;

export enum BuildStatus
{
    Succeeded = "succeeded",
    Failed = "failed",
}

export enum ActionStatus
{
    Succeeded = "succeeded",
    Failed = "failed",
    Skipped = "skipped",
}

export enum ProjectBuildStatus
{
    Built = "built",
    Failed = "failed",
    Skipped = "skipped",
}

// The settled state of one action node in the build tree (spec §10.2).
export interface ActionOutcome
{
    Name: string;
    Status: ActionStatus;
    DurationMs: number;
    Diagnostics: readonly BuildDiagnostic[];
}

// One project's report: the settled action tree plus aggregate diagnostics,
// produced artifacts, and timings.
export interface BuildResult
{
    Ok: boolean;
    Status: BuildStatus;
    Actions: readonly ActionOutcome[];
    Diagnostics: readonly BuildDiagnostic[];
    Artifacts: readonly string[];
    OutputPath?: string;
    DurationMs: number;
}

export interface ProjectBuildOutcome
{
    ProjectId: ProjectId;
    Status: ProjectBuildStatus;
    /** Absent when the project was Skipped. */
    Result?: BuildResult;
}

// The whole solution run (spec §9.1, §10.2).
export interface SolutionBuildResult
{
    Ok: boolean;
    Order: readonly ProjectId[];
    Projects: readonly ProjectBuildOutcome[];
    Diagnostics: readonly BuildDiagnostic[];
    DurationMs: number;
}
