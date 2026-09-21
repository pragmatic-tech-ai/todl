import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { PackageRef } from "../../publish/publish.js";

// A compiled package as a source returns it: the model.json document plus the base
// deps it recorded, for the recursive base walk.
export interface SourcedPackage
{
    Document: TodlDocument;
    Dependencies: readonly PackageRef[];
}

// The seam the recursive resolver reads packages through (spec §8). A miss returns
// undefined so a composite can fall through to the next source. Keyed by id@version;
// PackageKind does not route (package ids are globally unique). Phase 1 defines the
// seam; Phase 2 supplies the composite/caching/cache/registry implementations and
// migrates the resolver onto it.
export interface IPackageSource
{
    TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>;
}
