// todl-build-system — the todl-coupled realization of build-system-core: the package
// sources (compiled todl packages), the npm-package build system + its actions, the
// solution build manager, and the todl build context/facade that bind the generic core.
export type { IPackageSource, SourcedPackage } from "./package-source.js";
export { CompositePackageSource } from "./composite-package-source.js";
export { CachingPackageSource } from "./caching-package-source.js";
export { SolutionCacheSource, type IWritablePackageSource } from "./solution-cache-source.js";
export { RegistrySource } from "./registry-source.js";
export { SolutionRestore, type RestoreResult } from "./solution-restore.js";
export { PackageStoreKey, StoragePackageStore, type IPackageStore } from "./package-store.js";
export type { TodlBuildContext, TodlBuildRequest } from "./todl-build-context.js";
export { TodlProjectBuildManager } from "./todl-project-build-manager.js";
// Composition: the pre-populated registry, the build settings bag, and the module.
export { TodlBuildSystemRegistry } from "./todl-build-system-registry.js";
export { TodlBuildSettings } from "./todl-build-settings.js";
export { TodlBuildSystemEngine } from "./todl-build-system-module.mu.js";
// npm-package build system (spec §4): resolve -> compile -> emit.
export { NpmArtifacts } from "./npm/npm-artifacts.js";
export { ResolveBasesAction } from "./npm/resolve-bases-action.js";
export { CompileModelAction } from "./npm/compile-model-action.js";
export { EmitPackageLayoutAction } from "./npm/emit-package-layout-action.js";
export { GeneratePresentationAction } from "./npm/generate-presentation-action.js";
export { NpmPackageBuildSystem } from "./npm/npm-package-build-system.js";
// html-bundle build system (spec: single-page app for architecture projects).
export { HtmlBundleBuildSystem } from "./html-bundle/html-bundle-build-system.js";
export { CollectBundleResourcesAction } from "./html-bundle/collect-bundle-resources-action.js";
export { EmitBundledHostAction } from "./html-bundle/emit-bundled-host-action.js";
// Solution builds (spec §9): dependency-ordered multi-project build.
export { BuildOutputSource } from "./solution/build-output-source.js";
export {
    SolutionBuildManager,
    type SolutionProject,
    type SolutionBuildRequest,
} from "./solution/solution-build-manager.js";
