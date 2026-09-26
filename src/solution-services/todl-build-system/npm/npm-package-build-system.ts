import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import { StaticBuildFlavor, type BuildFlavor } from "../../build-system-core/build-flavor.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import type { IPresentationBaker } from "../../project-services/core/presentation-baker.js";
import { ResolveBasesAction } from "./resolve-bases-action.js";
import { CompileModelAction } from "./compile-model-action.js";
import { CompileMuralAction } from "./compile-mural-action.js";
import { StampResourceKeysAction } from "./stamp-resource-keys-action.js";
import { BakeResourcesAction } from "./bake-resources-action.js";
import { EmitPackageLayoutAction } from "./emit-package-layout-action.js";

// The npm-package output (spec §4): resolve bases -> compile model -> compile mural ->
// stamp resource keys -> bake resources -> emit the package layout. Applies to every
// publishable project type — meta-model, library, and architecture (each carries a graph
// fragment). Presentation baking is mural-coupled: the concrete IPresentationBaker lives
// host-side and is passed in through the constructor; the headless pipeline still runs
// compile-mural + stamp-resource-keys on its own, and BakeResourcesAction itself skips
// cleanly when no baker is supplied.
export class NpmPackageBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    private static readonly SystemId = "npm-package";
    private static readonly Display = "npm package";
    private static readonly Output = "npm-package";

    public readonly Id = NpmPackageBuildSystem.SystemId;
    public readonly DisplayName = NpmPackageBuildSystem.Display;

    private readonly actions: readonly IBuildAction<TodlBuildContext>[];

    constructor(baker?: IPresentationBaker)
    {
        this.actions = [
            new ResolveBasesAction(),
            new CompileModelAction(),
            new CompileMuralAction(),
            new StampResourceKeysAction(),
            new BakeResourcesAction(baker),
            new EmitPackageLayoutAction(),
        ];
    }

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return manifest.type === ProjectType.MetaModel
            || manifest.type === ProjectType.Library
            || manifest.type === ProjectType.Architecture;
    }

    public Flavors(): readonly BuildFlavor<TodlBuildContext>[]
    {
        return [new StaticBuildFlavor(
            NpmPackageBuildSystem.SystemId,
            NpmPackageBuildSystem.Display,
            NpmPackageBuildSystem.Output,
            this.actions,
        )];
    }
}
