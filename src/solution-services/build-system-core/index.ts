// build-system-core — the generic build-action pipeline framework. Zero todl imports:
// the action context, systems, registry, and managers are parameterized over the host's
// context + build-target types (todl binds them in todl-build-system).
export { ArtifactKey } from "./artifact-key.js";
export { BuildArtifacts } from "./build-artifacts.js";
export { DiagnosticSink, Severity, type BuildDiagnostic } from "./diagnostic-sink.js";
export type { BuildOptions } from "./build-options.js";
export type { CoreBuildContext, IBuildAction } from "./build-action.js";
export type { IBuildSystem } from "./build-system.js";
export { StaticBuildFlavor, type BuildFlavor } from "./build-flavor.js";
export { BuildSystemRegistry } from "./build-system-registry.js";
export { NoOpBuildProgress, type IBuildProgress } from "./build-progress.js";
export { type IBuildStorageProvider, type OpenedOutput } from "./build-storage-provider.js";
export { StorageTree } from "./storage-tree.js";
export {
    BuildStatus,
    ActionStatus,
    ProjectBuildStatus,
    type ProjectId,
    type ActionOutcome,
    type BuildResult,
    type ProjectBuildOutcome,
    type SolutionBuildResult,
} from "./build-result.js";
export {
    ProjectBuildManager,
    type ProjectBuildRequest,
    type ProjectBuildOutput,
    type BuildContextFactory,
} from "./project-build-manager.js";
export { SolutionDependencyGraph, type SolutionOrder } from "./solution/solution-dependency-graph.js";
