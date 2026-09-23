import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import { toPackageJson } from "../../package-manager/package-json.js";
import type { PackageDocument } from "../../../publish/publish.js";
import { BuildSystemRegistry } from "../../build-system-core/build-system-registry.js";
import type { IBuildStorageProvider } from "../../build-system-core/build-storage-provider.js";
import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildProgress } from "../../build-system-core/build-progress.js";
import { NoOpBuildProgress } from "../../build-system-core/build-progress.js";
import type { BuildOptions } from "../../build-system-core/build-options.js";
import type { IPackageSource, SourcedPackage } from "../package-source.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { CompositePackageSource } from "../composite-package-source.js";
import { DiagnosticSink, Severity } from "../../build-system-core/diagnostic-sink.js";
import { TodlProjectBuildManager } from "../todl-project-build-manager.js";
import {
    ProjectBuildStatus,
    type ProjectId,
    type ProjectBuildOutcome,
    type SolutionBuildResult,
} from "../../build-system-core/build-result.js";
import { SolutionDependencyGraph } from "../../build-system-core/solution/solution-dependency-graph.js";
import { BuildOutputSource } from "./build-output-source.js";

export interface SolutionProject
{
    Id: ProjectId;
    Project: IStorage;
    Manifest: ProjectManifest;
}

export interface SolutionBuildRequest
{
    Projects: readonly SolutionProject[];
    BuildSystemId: string;
    BuildFlavorId?: string;
    /** The source behind the fresh build outputs (solution cache / registry / node_modules). */
    ExternalSource: IPackageSource;
    /** Omit to build the whole solution; set to build a target's upstream closure. */
    Target?: ProjectId;
    Options?: BuildOptions;
    Progress?: IBuildProgress;
    /** Add-only ordering overrides: [dependent, dependency] — dependent builds after dependency. */
    ExplicitEdges?: readonly (readonly [ProjectId, ProjectId])[];
}

// Builds a solution's projects in dependency order (spec §9). Derives the graph from
// base bindings (+ explicit overrides), topo-sorts it (rejecting cycles), and runs each
// applicable project through the per-project ProjectBuildManager, threading each fresh
// output into a BuildOutputSource at the front of the composite so dependents resolve
// their siblings' just-built packages. Fail-fast; supports target-scoped closures.
export class SolutionBuildManager
{
    private static readonly ModelFileName = "model.json";
    private static readonly UnknownSystemPrefix = "unknown build system:";
    private static readonly CyclePrefix = "dependency cycle:";

    private readonly projectManager: TodlProjectBuildManager;

    constructor(
        private readonly registry: BuildSystemRegistry<TodlBuildContext, ProjectManifest>,
        private readonly storage: IBuildStorageProvider,
    )
    {
        this.projectManager = new TodlProjectBuildManager(registry, storage);
    }

    public async Build(request: SolutionBuildRequest): Promise<SolutionBuildResult>
    {
        const start = Date.now();
        const diagnostics = new DiagnosticSink();

        const system = this.registry.Get(request.BuildSystemId);
        if (system === undefined)
        {
            diagnostics.Report({ severity: Severity.Error, message: `${SolutionBuildManager.UnknownSystemPrefix} ${request.BuildSystemId}` });
            return SolutionBuildManager.Result(false, [], [], diagnostics, start);
        }

        const byId = new Map(request.Projects.map((p) => [p.Id, p]));
        const deps = SolutionBuildManager.DependencyEdges(request.Projects, request.ExplicitEdges ?? []);
        const graph = SolutionDependencyGraph.Order(deps);
        if (graph.Cycle !== undefined)
        {
            diagnostics.Report({ severity: Severity.Error, message: `${SolutionBuildManager.CyclePrefix} ${graph.Cycle.join(" -> ")}` });
            return SolutionBuildManager.Result(false, [], [], diagnostics, start);
        }

        let order = graph.Order.filter((id) => SolutionBuildManager.Applies(system, byId.get(id)));
        if (request.Target !== undefined)
        {
            const closure = SolutionDependencyGraph.Closure(deps, request.Target);
            order = order.filter((id) => closure.has(id));
        }

        const progress = request.Progress ?? new NoOpBuildProgress();
        progress.SolutionStarted(order);
        const outcomes = await this.RunProjects(order, byId, system, request, new BuildOutputSource());
        const ok = outcomes.every((o) => o.Status !== ProjectBuildStatus.Failed);
        return SolutionBuildManager.Result(ok, order, outcomes, diagnostics, start);
    }

    private async RunProjects(
        order: readonly ProjectId[],
        byId: ReadonlyMap<ProjectId, SolutionProject>,
        system: IBuildSystem<TodlBuildContext, ProjectManifest>,
        request: SolutionBuildRequest,
        buildOutput: BuildOutputSource,
    ): Promise<readonly ProjectBuildOutcome[]>
    {
        const outcomes: ProjectBuildOutcome[] = [];
        let stopped = false;
        for (const id of order)
        {
            const project = byId.get(id)!;
            if (stopped)
            {
                outcomes.push({ ProjectId: id, Status: ProjectBuildStatus.Skipped });
                continue;
            }

            const options: BuildOptions = { OutputRootOverride: id };
            const { Result: result } = await this.projectManager.Build({
                Project: project.Project,
                Manifest: project.Manifest,
                BuildSystemId: request.BuildSystemId,
                ...(request.BuildFlavorId !== undefined ? { BuildFlavorId: request.BuildFlavorId } : {}),
                Source: new CompositePackageSource([buildOutput, request.ExternalSource]),
                Options: options,
                ...(request.Progress !== undefined ? { Progress: request.Progress } : {}),
            });

            if (result.Ok)
            {
                await this.CaptureOutput(project, system, options, request.BuildFlavorId, buildOutput);
                outcomes.push({ ProjectId: id, Status: ProjectBuildStatus.Built, Result: result });
            }
            else
            {
                outcomes.push({ ProjectId: id, Status: ProjectBuildStatus.Failed, Result: result });
                stopped = true; // fail-fast (spec §9.5)
            }
        }
        return outcomes;
    }

    // Read the project's just-built model.json from its output and register it in the
    // build-output source so dependents resolve the fresh sibling.
    private async CaptureOutput(project: SolutionProject, system: IBuildSystem<TodlBuildContext, ProjectManifest>, options: BuildOptions, buildFlavorId: string | undefined, buildOutput: BuildOutputSource): Promise<void>
    {
        const flavor = BuildSystemRegistry.SelectFlavor(system, buildFlavorId);
        const output = await this.storage.OpenOutput(flavor?.OutputName ?? system.OutputName, options);
        if (!(await output.Storage.Exists(SolutionBuildManager.ModelFileName))) return;
        const document = JSON.parse(await output.Storage.ReadText(SolutionBuildManager.ModelFileName)) as PackageDocument;
        const pkg: SourcedPackage = { Document: { nodes: document.nodes, edges: document.edges }, Dependencies: document.dependencies ?? [] };
        const packageJson = toPackageJson(project.Manifest);
        buildOutput.Add(packageJson.todl.id, packageJson.version, pkg);
    }

    // Deps-first edge map: for each project, the sibling ids it depends on (its
    // metaModel + libraries bindings resolving to a sibling's produced id), plus any
    // explicit [dependent, dependency] overrides. Every project id is a key.
    private static DependencyEdges(
        projects: readonly SolutionProject[],
        explicit: readonly (readonly [ProjectId, ProjectId])[],
    ): Map<ProjectId, readonly ProjectId[]>
    {
        const producedToId = new Map<string, ProjectId>();
        for (const p of projects) producedToId.set(p.Manifest.id ?? p.Manifest.name, p.Id);

        const deps = new Map<ProjectId, ProjectId[]>();
        for (const p of projects)
        {
            const set = new Set<ProjectId>();
            for (const bindingId of SolutionBuildManager.BindingIds(p.Manifest))
            {
                const sibling = producedToId.get(bindingId);
                if (sibling !== undefined && sibling !== p.Id) set.add(sibling);
            }
            deps.set(p.Id, [...set]);
        }
        for (const [from, to] of explicit)
        {
            const existing = deps.get(from) ?? [];
            if (!existing.includes(to)) deps.set(from, [...existing, to]);
            if (!deps.has(to)) deps.set(to, []);
        }
        return deps;
    }

    private static BindingIds(manifest: ProjectManifest): readonly string[]
    {
        const ids: string[] = [];
        for (const meta of manifest.metaModels ?? []) ids.push(meta.id);
        for (const library of manifest.libraries ?? []) ids.push(library.id);
        return ids;
    }

    private static Applies(system: IBuildSystem<TodlBuildContext, ProjectManifest>, project: SolutionProject | undefined): boolean
    {
        return project !== undefined && system.AppliesTo(project.Manifest);
    }

    private static Result(
        ok: boolean,
        order: readonly ProjectId[],
        projects: readonly ProjectBuildOutcome[],
        diagnostics: DiagnosticSink,
        start: number,
    ): SolutionBuildResult
    {
        return { Ok: ok, Order: order, Projects: projects, Diagnostics: diagnostics.All(), DurationMs: Date.now() - start };
    }
}
