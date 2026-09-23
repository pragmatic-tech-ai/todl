import type { BuildSystemRegistry } from "../build-system-core/build-system-registry.js";
import type { IBuildStorageProvider } from "../build-system-core/build-storage-provider.js";
import { ProjectBuildManager, type ProjectBuildOutput } from "../build-system-core/project-build-manager.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { TodlBuildContext, TodlBuildRequest } from "./todl-build-context.js";

// Binds the generic ProjectBuildManager to todl's context + manifest target and hides the
// context assembly, exposing a todl-shaped request. The context factory folds the todl
// channels (Manifest, Source) onto the generic core base; Source is captured per-build in
// the closure so it never becomes a field on the core request — keeping build-system-core
// free of any todl type. The project id is the manifest id, else its name.
export class TodlProjectBuildManager
{
    constructor(
        private readonly registry: BuildSystemRegistry<TodlBuildContext, ProjectManifest>,
        private readonly storage: IBuildStorageProvider,
    )
    {
    }

    public Build(request: TodlBuildRequest): Promise<ProjectBuildOutput>
    {
        const manager = new ProjectBuildManager<TodlBuildContext, ProjectManifest>(
            this.registry,
            this.storage,
            (base) => ({ ...base, Manifest: request.Manifest, Source: request.Source }),
        );
        return manager.Build({
            Project: request.Project,
            Id: request.Manifest.id ?? request.Manifest.name,
            Target: request.Manifest,
            BuildSystemId: request.BuildSystemId,
            ...(request.BuildFlavorId !== undefined ? { BuildFlavorId: request.BuildFlavorId } : {}),
            ...(request.Options !== undefined ? { Options: request.Options } : {}),
            ...(request.Progress !== undefined ? { Progress: request.Progress } : {}),
        });
    }
}
