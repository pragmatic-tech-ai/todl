import type { CoreBuildContext, IBuildAction } from "./build-action.js";

// A build system is the whole pipeline for one output (spec §2.1). The user picks its
// DisplayName; OutputName names the output directory; AppliesTo gates it to the targets
// it can build; Actions() is the ordered list (self-describing — no NeedsModel /
// RequiredGenerators flags). C is the action-context type its actions require; T is the
// build-target type AppliesTo inspects. A host binds both — todl uses TodlBuildContext +
// ProjectManifest.
export interface IBuildSystem<C extends CoreBuildContext, T>
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly OutputName: string;
    AppliesTo(target: T): boolean;
    Actions(): readonly IBuildAction<C>[];
}
