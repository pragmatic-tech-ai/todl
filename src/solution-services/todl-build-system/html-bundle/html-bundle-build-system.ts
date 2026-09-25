import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import { StaticBuildFlavor, type BuildFlavor } from "../../build-system-core/build-flavor.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import { ResolveBasesAction } from "../npm/resolve-bases-action.js";
import { CompileModelAction } from "../npm/compile-model-action.js";
import { GenerateModelDtoAction } from "./generate-model-dto-action.js";
import { GenerateAppUiAction } from "./generate-app-ui-action.js";
import { EmitEntryAction } from "./emit-entry-action.js";
import { CompileMuralAction } from "./compile-mural-action.js";
import { BundleAppAction } from "./bundle-app-action.js";
import { EmitBundledHostAction } from "./emit-bundled-host-action.js";

// Builds a self-contained single-page HTML app for an ARCHITECTURE project: resolve bases
// -> compile the full closure -> emit index.html with the model shards + mural host bundle inlined.
// Architecture-only — meta-models and libraries publish via the npm-package system.
export class HtmlBundleBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    private static readonly SystemId = "html-bundle";
    private static readonly Display = "HTML app";
    private static readonly Output = "html-bundle";

    public readonly Id = HtmlBundleBuildSystem.SystemId;
    public readonly DisplayName = HtmlBundleBuildSystem.Display;

    // Order is a controller ruling (spec §per-project-app-build, task 8): it satisfies
    // consume-before-produce AND the file dependency CompileMural needs — generated/app.mu
    // (written by GenerateAppUiAction) must already exist in the Project before CompileMural
    // walks it looking for .mu sources.
    private readonly actions: readonly IBuildAction<TodlBuildContext>[] = [
        new ResolveBasesAction(),
        new CompileModelAction(),
        new GenerateModelDtoAction(),
        new GenerateAppUiAction(),
        new EmitEntryAction(),
        new CompileMuralAction(),
        new BundleAppAction(),
        new EmitBundledHostAction(),
    ];

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return manifest.type === ProjectType.Architecture;
    }

    public Flavors(): readonly BuildFlavor<TodlBuildContext>[]
    {
        return [new StaticBuildFlavor(
            HtmlBundleBuildSystem.SystemId,
            HtmlBundleBuildSystem.Display,
            HtmlBundleBuildSystem.Output,
            this.actions,
        )];
    }
}
