import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { BuildSystemRegistry } from "./build-system-registry.js";
import type { IBuildStorageProvider } from "./build-storage-provider.js";
import type { CoreBuildContext, IBuildAction } from "./build-action.js";
import type { IBuildSystem } from "./build-system.js";
import type { IBuildProgress } from "./build-progress.js";
import { NoOpBuildProgress } from "./build-progress.js";
import type { BuildOptions } from "./build-options.js";
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
// (registry, storage provider, context factory) are constructor-injected; this carries
// the per-build inputs. Target is what AppliesTo inspects and the context factory
// consumes; Id is the project id used in progress/report (host-derived, since core
// names no manifest type).
export interface ProjectBuildRequest<T>
{
    Project: IStorage;
    Id: ProjectId;
    Target: T;
    BuildSystemId: string;
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

// Builds the host-specific context from the generic base + the request. Core provides
// the base (Project/Sandbox/Artifacts/Options/Diagnostics); the host folds on its own
// fields (todl adds Manifest + Source). Keeps every todl type out of core.
export type BuildContextFactory<C extends CoreBuildContext, T> =
    (base: CoreBuildContext, request: ProjectBuildRequest<T>) => C;

// Runs one project's build system: provision sandbox + open output, run the actions
// over a shared context (diagnostics-driven stop, spec §3), promote on success, write
// report.json (even on failure), delete the sandbox, and return the settled report.
// Generic over the action-context type C and build-target type T; the context factory
// is injected so core never names a todl type.
export class ProjectBuildManager<C extends CoreBuildContext, T>
{
    private static readonly ReportFileName = "report.json";
    private static readonly UnknownSystemPrefix = "unknown build system:";
    private static readonly NotApplicablePrefix = "build system does not apply to project:";
    private static readonly ActionFailedPrefix = "action failed:";

    constructor(
        private readonly registry: BuildSystemRegistry<C, T>,
        private readonly storage: IBuildStorageProvider,
        private readonly makeContext: BuildContextFactory<C, T>,
    )
    {
    }

    public async Build(request: ProjectBuildRequest<T>): Promise<ProjectBuildOutput>
    {
        const system = this.registry.Get(request.BuildSystemId);
        if (system === undefined)
        {
            throw new Error(`${ProjectBuildManager.UnknownSystemPrefix} ${request.BuildSystemId}`);
        }
        if (!system.AppliesTo(request.Target))
        {
            throw new Error(`${ProjectBuildManager.NotApplicablePrefix} ${system.Id}`);
        }
        return this.Run(system, request);
    }

    private async Run(system: IBuildSystem<C, T>, request: ProjectBuildRequest<T>): Promise<ProjectBuildOutput>
    {
        const progress = request.Progress ?? new NoOpBuildProgress();
        const options = request.Options ?? {};
        const projectId = request.Id;
        const start = Date.now();

        const sandbox = await this.storage.CreateSandbox();
        const output = await this.storage.OpenOutput(system.OutputName, options);
        const diagnostics = new DiagnosticSink();
        const base: CoreBuildContext = {
            Project: request.Project,
            Sandbox: sandbox,
            Artifacts: new BuildArtifacts(),
            Options: options,
            Diagnostics: diagnostics,
        };
        const context: C = this.makeContext(base, request);

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
        actions: readonly IBuildAction<C>[],
        context: C,
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
}
