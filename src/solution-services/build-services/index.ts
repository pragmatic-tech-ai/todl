// build-services — a unified build-action pipeline (spec: build-services design).
// Phase 1: the single-project framework core + status/progress. Phases 2-4 add the
// package-source implementations, the npm build system, and solution builds.
export { ArtifactKey } from "./artifact-key.js";
export { BuildArtifacts } from "./build-artifacts.js";
export { DiagnosticSink, Severity, type BuildDiagnostic } from "./diagnostic-sink.js";
export type { IPackageSource, SourcedPackage } from "./package-source.js";
export { CompositePackageSource } from "./composite-package-source.js";
export { CachingPackageSource } from "./caching-package-source.js";
export { SolutionCacheSource, type IWritablePackageSource } from "./solution-cache-source.js";
export { RegistrySource } from "./registry-source.js";
export { SolutionRestore, type RestoreResult } from "./solution-restore.js";
export { PackageStoreKey, StoragePackageStore, type IPackageStore } from "./package-store.js";
export type { BuildOptions } from "./build-options.js";
export type { IBuildAction, BuildActionContext } from "./build-action.js";
export type { IBuildSystem } from "./build-system.js";
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
export { ProjectBuildManager, type ProjectBuildRequest } from "./project-build-manager.js";
// npm-package build system (spec §4): resolve -> compile -> emit.
export { NpmArtifacts } from "./npm/npm-artifacts.js";
export { ResolveBasesAction } from "./npm/resolve-bases-action.js";
export { CompileModelAction } from "./npm/compile-model-action.js";
export { EmitPackageLayoutAction } from "./npm/emit-package-layout-action.js";
export { NpmPackageBuildSystem } from "./npm/npm-package-build-system.js";
// Solution builds (spec §9): dependency-ordered multi-project build.
export { SolutionDependencyGraph, type SolutionOrder } from "./solution/solution-dependency-graph.js";
export { BuildOutputSource } from "./solution/build-output-source.js";
export {
    SolutionBuildManager,
    type SolutionProject,
    type SolutionBuildRequest,
} from "./solution/solution-build-manager.js";
