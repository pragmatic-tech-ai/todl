import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { BuildSystemRegistry } from "./build-system-registry.js";
import type { IBuildStorageProvider } from "./build-storage-provider.js";
import type { IBuildAction, BuildActionContext } from "./build-action.js";
import type { IBuildSystem } from "./build-system.js";
import type { IBuildProgress } from "./build-progress.js";
import { NoOpBuildProgress } from "./build-progress.js";
import type { BuildOptions } from "./build-options.js";
import type { IPackageSource } from "./package-source.js";
import { BuildArtifacts } from "./build-artifacts.js";
import { DiagnosticSink, Severity } from "./diagnostic-sink.js";
import { StorageTree } from "./storage-tree.js";
import {
    ActionStatus,
    BuildStatus,
    ProjectBuildStatus,
    type ActionOutcome,
    type BuildResult,
    type ProjectId,
} from "./build-result.js";

// One project's build request. A DTO, not a seam bag — the manager's dependencies
// (registry, storage provider) are constructor-injected; this carries the per-build
// inputs.
export interface ProjectBuildRequest
{
    Project: IStorage;
    Manifest: ProjectManifest;
    BuildSystemId: string;
    Source: IPackageSource;
    Options?: BuildOptions;
    Progress?: IBuildProgress;
}

// A finished build: the serializable settled report (written to report.json, threaded
// into solution results) plus the LIVE produced-artifact bag. The bag stays out of the
// report (it holds in-memory values like the compiled package a host registers locally,
// not a serialization concern); a direct caller reads it, a serializing caller ignores it.
export interface ProjectBuildOutput
{
    Result: BuildResult;
    Artifacts: BuildArtifacts;
}

// Runs one project's build system: provision sandbox + open output, run the actions
// over a shared context (diagnostics-driven stop, spec §3), promote on success, write
// report.json (even on failure), delete the sandbox, and return the settled report.
export class ProjectBuildManager
{
    private static readonly ReportFileName = "report.json";
    private static readonly UnknownSystemPrefix = "unknown build system:";
    private static readonly NotApplicablePrefix = "build system does not apply to project:";
    private static readonly ActionFailedPrefix = "action failed:";

    constructor(
        private readonly registry: BuildSystemRegistry,
        private readonly storage: IBuildStorageProvider,
    )
    {
    }

    public async Build(request: ProjectBuildRequest): Promise<ProjectBuildOutput>
    {
        const system = this.registry.Get(request.BuildSystemId);
        if (system === undefined)
        {
            throw new Error(`${ProjectBuildManager.UnknownSystemPrefix} ${request.BuildSystemId}`);
        }
        if (!system.AppliesTo(request.Manifest))
        {
            throw new Error(`${ProjectBuildManager.NotApplicablePrefix} ${system.Id}`);
        }
        return this.Run(system, request);
    }

    private async Run(system: IBuildSystem, request: ProjectBuildRequest): Promise<ProjectBuildOutput>
    {
        const progress = request.Progress ?? new NoOpBuildProgress();
        const options = request.Options ?? {};
        const projectId = ProjectBuildManager.ProjectIdOf(request.Manifest);
        const start = Date.now();

        const sandbox = await this.storage.CreateSandbox();
        const output = await this.storage.OpenOutput(system.OutputName, options);
        const diagnostics = new DiagnosticSink();
        const context: BuildActionContext = {
            Project: request.Project,
            Sandbox: sandbox,
            Artifacts: new BuildArtifacts(),
            Source: request.Source,
            Manifest: request.Manifest,
            Options: options,
            Diagnostics: diagnostics,
        };

        const actions = system.Actions();
        progress.ProjectStarted(projectId, actions.map((a) => a.Name));
        const outcomes = await this.RunActions(actions, context, diagnostics, progress, projectId);
        const ok = outcomes.every((o) => o.Status !== ActionStatus.Failed);

        if (ok) await StorageTree.CopyAll(sandbox, output.Storage);
        const artifacts = ok ? await StorageTree.Files(output.Storage) : [];

        const result: BuildResult = {
            Ok: ok,
            Status: ok ? BuildStatus.Succeeded : BuildStatus.Failed,
            Actions: outcomes,
            Diagnostics: diagnostics.All(),
            Artifacts: artifacts,
            OutputPath: output.Path,
            DurationMs: Date.now() - start,
        };

        await output.Storage.WriteText(ProjectBuildManager.ReportFileName, JSON.stringify(result, null, 2));
        await this.storage.DeleteSandbox(sandbox);
        progress.ProjectFinished(projectId, ok ? ProjectBuildStatus.Built : ProjectBuildStatus.Failed);
        return { Result: result, Artifacts: context.Artifacts };
    }

    private async RunActions(
        actions: readonly IBuildAction[],
        context: BuildActionContext,
        diagnostics: DiagnosticSink,
        progress: IBuildProgress,
        projectId: ProjectId,
    ): Promise<readonly ActionOutcome[]>
    {
        const outcomes: ActionOutcome[] = [];
        let stopped = false;
        for (const action of actions)
        {
            if (stopped)
            {
                outcomes.push({ Name: action.Name, Status: ActionStatus.Skipped, DurationMs: 0, Diagnostics: [] });
                progress.ActionFinished(projectId, action.Name, ActionStatus.Skipped);
                continue;
            }

            progress.ActionStarted(projectId, action.Name);
            const checkpoint = diagnostics.Count;
            const actionStart = Date.now();
            let threw = false;
            try
            {
                await action.Execute(context);
            }
            catch (e)
            {
                diagnostics.Report({
                    severity: Severity.Error,
                    message: `${ProjectBuildManager.ActionFailedPrefix} ${action.Name}: ${(e as Error).message}`,
                    source: action.Name,
                });
                threw = true;
            }

            const added = diagnostics.All().slice(checkpoint);
            for (const diagnostic of added) progress.Diagnostic(projectId, diagnostic);

            const failed = threw || diagnostics.HasErrorsSince(checkpoint);
            const status = failed ? ActionStatus.Failed : ActionStatus.Succeeded;
            outcomes.push({ Name: action.Name, Status: status, DurationMs: Date.now() - actionStart, Diagnostics: added });
            progress.ActionFinished(projectId, action.Name, status);
            if (failed) stopped = true;
        }
        return outcomes;
    }

    // A single project's id for progress/report: its package id, else its name.
    private static ProjectIdOf(manifest: ProjectManifest): ProjectId
    {
        return manifest.id ?? manifest.name;
    }
}
