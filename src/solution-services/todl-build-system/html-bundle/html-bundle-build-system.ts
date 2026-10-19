import { ServiceProvider, type IServiceContainer } from "@pragmatic-tech-ai/todl-runtime";
import type { IBuildSystem } from "../../build-system-core/build-system.js";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import { StaticBuildFlavor, type BuildFlavor, type RequiredContent } from "../../build-system-core/build-flavor.js";
import { BundlerKey, type IBundler } from "../../build-system-core/bundler.js";
import { BuildSystemRegistryKey } from "../../project-services/composition/build-system-registry-key.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";
import { ResolveBasesAction } from "../npm/resolve-bases-action.js";
import { CompileModelAction } from "../npm/compile-model-action.js";
import { EmitEntryAction } from "./emit-entry-action.js";
import { CompileMuralAction } from "./compile-mural-action.js";
import { BundleAppAction } from "./bundle-app-action.js";
import { EmitBundledHostAction } from "./emit-bundled-host-action.js";
import { TypeCheckAction } from "./type-check-action.js";
import { EmitRemoteDataAction } from "./emit-remote-data-action.js";
import { EmitRemoteEntryAction } from "./emit-remote-entry-action.js";
import { EmitRemoteHostAction } from "./emit-remote-host-action.js";
import { TypeCheckerKey, type ITypeChecker } from "../../build-system-core/type-checker.js";

// Builds a self-contained single-page HTML app for an ARCHITECTURE project: resolve bases
// -> compile the full closure -> emit index.html with the model shards + mural host bundle inlined.
// Architecture-only — meta-models and libraries publish via the npm-package system.
export class HtmlBundleBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    private static readonly SystemId = "html-bundle";
    private static readonly Display = "HTML app";
    private static readonly Output = "html-bundle";
    private static readonly RemoteFlavorId = "html-bundle-remote";
    private static readonly RemoteDisplay = "HTML app (remote)";
    private static readonly RemoteOutput = "html-bundle-remote";

    // The "require, never create" boundary (spec §per-project-app-build, task 11): the
    // model DTO and default app UI are now project content the generators (DtoGenerator/
    // AppGenerator) own — this flavor only requires they already exist, and
    // fails fast (before provisioning) with a hint naming the generator to run.
    private static readonly ModelDtoPath = "generated/model.ts";
    private static readonly ModelDtoGeneratorId = "model-dto";
    private static readonly ModelDataPath = "generated/data.ts";
    private static readonly ModelDataGeneratorId = "model-data";
    private static readonly AppViewModelPath = "src/main.ts";
    private static readonly AppViewModelGeneratorId = "app-view-model";
    private static readonly AppUiPath = "src/app.mu";
    private static readonly AppUiGeneratorId = "app-ui";
    private static readonly RequiredContent: readonly RequiredContent[] = [
        { Path: HtmlBundleBuildSystem.ModelDtoPath, GeneratorId: HtmlBundleBuildSystem.ModelDtoGeneratorId },
        { Path: HtmlBundleBuildSystem.ModelDataPath, GeneratorId: HtmlBundleBuildSystem.ModelDataGeneratorId },
        { Path: HtmlBundleBuildSystem.AppViewModelPath, GeneratorId: HtmlBundleBuildSystem.AppViewModelGeneratorId },
        { Path: HtmlBundleBuildSystem.AppUiPath, GeneratorId: HtmlBundleBuildSystem.AppUiGeneratorId },
    ];
    // Remote flavor: generated/data.ts is NOT required; the build supplies its own in the sandbox.
    private static readonly RemoteRequiredContent: readonly RequiredContent[] =
        HtmlBundleBuildSystem.RequiredContent.filter(r => r.Path !== HtmlBundleBuildSystem.ModelDataPath);

    public readonly Id = HtmlBundleBuildSystem.SystemId;
    public readonly DisplayName = HtmlBundleBuildSystem.Display;

    // Order satisfies consume-before-produce: resolve -> compile -> emit the sandbox
    // entry -> compile mural (reading src/app.mu required above) -> bundle -> emit.
    private readonly actions: readonly IBuildAction<TodlBuildContext>[];

    // The remote flavor: no inlined snapshot. The sandbox generated/data.ts (shadowing the
    // project's) reads the live tenant; the entry awaits the first fetch before mounting.
    // EmitRemoteData runs before the bundle so the bundler sees the shadowing file.
    private readonly remoteActions: readonly IBuildAction<TodlBuildContext>[];

    constructor(bundler: IBundler, typeChecker: ITypeChecker)
    {
        this.actions = [
            new ResolveBasesAction(),
            new CompileModelAction(),
            new EmitEntryAction(),
            new CompileMuralAction(),
            new BundleAppAction(bundler),
            new TypeCheckAction(typeChecker),
            new EmitBundledHostAction(),
        ];
        this.remoteActions = [
            new ResolveBasesAction(),
            new CompileModelAction(),
            new EmitRemoteDataAction(),
            new EmitRemoteEntryAction(),
            new CompileMuralAction(),
            new BundleAppAction(bundler),
            new TypeCheckAction(typeChecker),
            new EmitRemoteHostAction(),
        ];
    }

    public static Register(container: IServiceContainer): void
    {
        const provider = container as unknown as ServiceProvider;
        container.register(HtmlBundleBuildSystem, (p) => new HtmlBundleBuildSystem(p.getRequired(BundlerKey), p.getRequired(TypeCheckerKey)));
        provider.getRequired(BuildSystemRegistryKey).RegisterResolved(provider.getRequired(HtmlBundleBuildSystem));
    }

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return manifest.type === ProjectType.Architecture;
    }

    public Flavors(): readonly BuildFlavor<TodlBuildContext>[]
    {
        return [
            new StaticBuildFlavor(
                HtmlBundleBuildSystem.SystemId,
                HtmlBundleBuildSystem.Display,
                HtmlBundleBuildSystem.Output,
                this.actions,
                HtmlBundleBuildSystem.RequiredContent,
            ),
            new StaticBuildFlavor(
                HtmlBundleBuildSystem.RemoteFlavorId,
                HtmlBundleBuildSystem.RemoteDisplay,
                HtmlBundleBuildSystem.RemoteOutput,
                this.remoteActions,
                HtmlBundleBuildSystem.RemoteRequiredContent,
            ),
        ];
    }
}
