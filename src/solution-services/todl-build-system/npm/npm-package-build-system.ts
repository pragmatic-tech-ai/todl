import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import { ResolveBasesAction } from "./resolve-bases-action.js";
import { CompileModelAction } from "./compile-model-action.js";
import { EmitPackageLayoutAction } from "./emit-package-layout-action.js";

// The npm-package output (spec §4): resolve bases -> compile model -> [host generators]
// -> emit the package layout. Applies to every publishable project type — meta-model,
// library, and architecture (each carries a graph fragment). Presentation baking is a
// mural-coupled project content generator the host (Plexus) supplies via the constructor
// when a baker is available (GeneratePresentationAction); the headless pipeline produces
// the model + handle + resources on its own. Generators run after compile (they read the
// compiled model) and before emit (they may stamp the document emit serializes, or stage
// extra files for promotion).
export class NpmPackageBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    private static readonly SystemId = "npm-package";
    private static readonly Display = "npm package";
    private static readonly Output = "npm-package";

    public readonly Id = NpmPackageBuildSystem.SystemId;
    public readonly DisplayName = NpmPackageBuildSystem.Display;
    public readonly OutputName = NpmPackageBuildSystem.Output;

    private readonly actions: readonly IBuildAction<TodlBuildContext>[];

    constructor(generators: readonly IBuildAction<TodlBuildContext>[] = [])
    {
        this.actions = [
            new ResolveBasesAction(),
            new CompileModelAction(),
            ...generators,
            new EmitPackageLayoutAction(),
        ];
    }

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return manifest.type === ProjectType.MetaModel
            || manifest.type === ProjectType.Library
            || manifest.type === ProjectType.Architecture;
    }

    public Actions(): readonly IBuildAction<TodlBuildContext>[]
    {
        return this.actions;
    }
}
