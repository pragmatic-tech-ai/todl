import type { ProjectManifest } from "../package-manager/manifest.js";
import type { IBuildAction } from "./build-action.js";

// A build system is the whole pipeline for one output (spec §2.1). The user picks
// its DisplayName; OutputName names the output directory; AppliesTo gates it to the
// projects it can build; Actions() is the ordered list (self-describing — no
// NeedsModel/RequiredGenerators flags).
export interface IBuildSystem
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly OutputName: string;
    AppliesTo(manifest: ProjectManifest): boolean;
    Actions(): readonly IBuildAction[];
}
