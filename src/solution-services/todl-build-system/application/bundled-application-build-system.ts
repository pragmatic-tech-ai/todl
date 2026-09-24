import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import { StaticBuildFlavor, type BuildFlavor } from "../../build-system-core/build-flavor.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import { ResolveBasesAction } from "../npm/resolve-bases-action.js";
import { CompileModelAction } from "../npm/compile-model-action.js";
import { GenerateModelPackageAction } from "./generate-model-package-action.js";

// Builds a self-contained runnable TypeScript package for an application (architecture)
// project: resolve bases -> compile the closure -> emit per-model ModelDataSources with
// embedded shards and a ModelRegistry factory. Distinct from html-bundle (HTML host) and
// npm-package (published model) — a separate Architecture-output system, selected by id.
export class BundledApplicationBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    private static readonly SystemId = "bundled-application";
    private static readonly Display = "Bundled application";
    private static readonly Output = "bundled-application";

    public readonly Id = BundledApplicationBuildSystem.SystemId;
    public readonly DisplayName = BundledApplicationBuildSystem.Display;

    private readonly actions: readonly IBuildAction<TodlBuildContext>[] = [
        new ResolveBasesAction(),
        new CompileModelAction(),
        new GenerateModelPackageAction(),
    ];

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return manifest.type === ProjectType.Architecture;
    }

    public Flavors(): readonly BuildFlavor<TodlBuildContext>[]
    {
        return [new StaticBuildFlavor(
            BundledApplicationBuildSystem.SystemId,
            BundledApplicationBuildSystem.Display,
            BundledApplicationBuildSystem.Output,
            this.actions,
        )];
    }
}
