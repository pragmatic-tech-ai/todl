import type { BuildFlavor } from "./build-flavor.js";
import type { CoreBuildContext } from "./build-action.js";

// A build system is the whole pipeline for one output (spec §2.1). The user picks its
// DisplayName; AppliesTo gates it to the projects it can build; Flavors() enumerates the
// named output variants (each carries its own OutputName and ordered action list). C is
// the action-context type its actions require; TProject is the project-descriptor type
// AppliesTo inspects. A host binds both — todl uses TodlBuildContext + ProjectManifest.
export interface IBuildSystem<C extends CoreBuildContext, TProject>
{
    readonly Id: string;
    readonly DisplayName: string;
    AppliesTo(project: TProject): boolean;
    Flavors(): readonly BuildFlavor<C>[];
}
