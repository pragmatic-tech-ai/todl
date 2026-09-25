import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import { StaticBuildFlavor, type BuildFlavor, type RequiredContent } from "../../build-system-core/build-flavor.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import { ResolveBasesAction } from "../npm/resolve-bases-action.js";
import { CompileModelAction } from "../npm/compile-model-action.js";
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

    // The "require, never create" boundary (spec §per-project-app-build, task 11): the
    // model DTO and default app UI are now project content the generators (DtoGenerator/
    // UiPlaceholderGenerator) own — this flavor only requires they already exist, and
    // fails fast (before provisioning) with a hint naming the generator to run.
    private static readonly ModelDtoPath = "generated/model.ts";
    private static readonly ModelDtoGeneratorId = "model-dto";
    private static readonly AppUiPath = "generated/app.mu";
    private static readonly AppUiGeneratorId = "app-ui";
    private static readonly RequiredContent: readonly RequiredContent[] = [
        { Path: HtmlBundleBuildSystem.ModelDtoPath, GeneratorId: HtmlBundleBuildSystem.ModelDtoGeneratorId },
        { Path: HtmlBundleBuildSystem.AppUiPath, GeneratorId: HtmlBundleBuildSystem.AppUiGeneratorId },
    ];

    public readonly Id = HtmlBundleBuildSystem.SystemId;
    public readonly DisplayName = HtmlBundleBuildSystem.Display;

    // Order satisfies consume-before-produce: resolve -> compile -> emit the sandbox
    // entry -> compile mural (reading generated/app.mu required above) -> bundle -> emit.
    private readonly actions: readonly IBuildAction<TodlBuildContext>[] = [
        new ResolveBasesAction(),
        new CompileModelAction(),
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
            HtmlBundleBuildSystem.RequiredContent,
        )];
    }
}
