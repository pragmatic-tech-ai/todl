import { BuildSystemRegistry } from "../build-system-core/build-system-registry.js";
import type { ProjectManifest } from "../package-manager/manifest.js";
import type { TodlBuildContext } from "./todl-build-context.js";
import { NpmPackageBuildSystem } from "./npm/npm-package-build-system.js";

// The build-system registry todl composes: a BuildSystemRegistry pre-populated with
// todl's built-in build systems — currently the headless npm-package system (no
// presentation generator; a host with a mural baker augments it by registering a variant
// that carries GeneratePresentationAction). Registered by the todl-build-system module so
// a host resolves the populated registry rather than hand-assembling it.
export class TodlBuildSystemRegistry extends BuildSystemRegistry<TodlBuildContext, ProjectManifest>
{
    constructor()
    {
        super();
        this.Register(new NpmPackageBuildSystem());
    }
}
