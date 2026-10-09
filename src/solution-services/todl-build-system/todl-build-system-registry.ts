import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { TypeCheckerKey, type ITypeChecker } from "../build-system-core/type-checker.js";
import { BuildSystemRegistry } from "../build-system-core/build-system-registry.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { TodlBuildContext } from "./todl-build-context.js";
import { NpmPackageBuildSystem } from "./npm/npm-package-build-system.js";
import { HtmlBundleBuildSystem } from "./html-bundle/html-bundle-build-system.js";
import { EsbuildBundler } from "./html-bundle/node/esbuild-bundler.js";
import { TscTypeChecker } from "./html-bundle/node/tsc-type-checker.js";
import { DefaultPresentationBaker } from "../project-services/core/default-presentation-baker.js";

// The build-system registry todl composes: a BuildSystemRegistry pre-populated with
// todl's built-in build systems — the npm-package system (its pipeline always compiles
// mural + stamps resource keys, then bakes presentation via DefaultPresentationBaker),
// plus the html-bundle system that packages an architecture as a self-contained
// single-page app. Registered by the todl-build-system module so a host resolves the
// populated registry rather than hand-assembling it.
//
// NpmPackageBuildSystem is constructed with TODL's own DefaultPresentationBaker here as
// an interim wiring; letting a host resolve a concrete IPresentationBaker through its own
// composer/IServiceProvider is a deferred follow-up — this registry has no such
// provider/service context to resolve one from.
export class TodlBuildSystemRegistry extends BuildSystemRegistry<TodlBuildContext, ProjectManifest>
{
    // The module DSL registers this as `new TodlBuildSystemRegistry(p)`, passing the provider.
    // The checker is resolved from it (TypeCheckerKey), falling back to the node tsc gate.
    constructor(provider?: IServiceProvider)
    {
        super();
        const typeChecker: ITypeChecker = provider?.get(TypeCheckerKey) ?? new TscTypeChecker();
        this.Register(new NpmPackageBuildSystem(new DefaultPresentationBaker()));
        this.Register(new HtmlBundleBuildSystem(new EsbuildBundler(), typeChecker));
    }
}
