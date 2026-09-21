import { ArtifactKey } from "../../build-system-core/artifact-key.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../../publish/publish.js";

// The typed artifacts the npm build actions hand between each other (spec §4). Static
// members so the produce/consume sites share one key identity.
export class NpmArtifacts
{
    public static readonly ResolvedBases = new ArtifactKey<readonly TodlDocument[]>("ResolvedBases");
    public static readonly CompiledModel = new ArtifactKey<CompiledPackage>("CompiledModel");
}
