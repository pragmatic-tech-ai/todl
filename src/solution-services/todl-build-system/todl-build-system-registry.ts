import { BuildSystemRegistry } from "../build-system-core/build-system-registry.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { TodlBuildContext } from "./todl-build-context.js";
import { NpmPackageBuildSystem } from "./npm/npm-package-build-system.js";
import { HtmlBundleBuildSystem } from "./html-bundle/html-bundle-build-system.js";

// The build-system registry todl composes: a BuildSystemRegistry pre-populated with
// todl's built-in build systems — the npm-package system (its pipeline always compiles
// mural + stamps resource keys; BakeResourcesAction itself skips cleanly with no baker),
// plus the html-bundle system that packages an architecture as a self-contained
// single-page app. Registered by the todl-build-system module so a host resolves the
// populated registry rather than hand-assembling it.
//
// NpmPackageBuildSystem is constructed with no baker here (an in-repo default, so bake
// skips cleanly); wiring a concrete host-supplied IPresentationBaker (e.g. resolved via
// PresentationBakerKey from a host's IServiceProvider) is a deferred follow-up — this
// registry has no such provider/service context to resolve one from.
export class TodlBuildSystemRegistry extends BuildSystemRegistry<TodlBuildContext, ProjectManifest>
{
    constructor()
    {
        super();
        this.Register(new NpmPackageBuildSystem());
        this.Register(new HtmlBundleBuildSystem());
    }
}
