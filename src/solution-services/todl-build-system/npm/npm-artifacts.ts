import { ArtifactKey } from "../../build-system-core/artifact-key.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../../publish/publish.js";

// A qualified, verbatim resource for the browser bundle: a `<model>/<version>/<path>` uri
// and its bytes, inlined (base64) into the page and served through a MemoryResourceSource.
export interface BundleResource
{
    uri: string;
    bytes: Uint8Array;
}

// The typed artifacts the npm build actions hand between each other (spec §4). Static
// members so the produce/consume sites share one key identity.
export class NpmArtifacts
{
    public static readonly ResolvedBases = new ArtifactKey<readonly TodlDocument[]>("ResolvedBases");
    public static readonly CompiledModel = new ArtifactKey<CompiledPackage>("CompiledModel");
    public static readonly BundleResources = new ArtifactKey<readonly BundleResource[]>("BundleResources");
}
