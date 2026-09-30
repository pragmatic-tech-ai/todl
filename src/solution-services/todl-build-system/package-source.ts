import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { PackageRef, PackageResource } from "../../publish/publish.js";

// A compiled package as a source returns it: the model.json document plus the base
// deps it recorded, for the recursive base walk.
export interface SourcedPackage
{
    Document: TodlDocument;
    Dependencies: readonly PackageRef[];
    resources?: readonly PackageResource[]; // verbatim non-.todl asset bytes, package-relative
}

// Optional context a resolver may pass to a source, identifying the CONSUMER project
// whose closure is being resolved. A context-free source (the common case) ignores it;
// a connection-aware source uses `consumerId` to pick that project's effective package
// registry/connection. Optional so every existing source and call site stays valid.
export interface PackageResolutionContext
{
    consumerId?: string;
}

// The seam the recursive resolver reads packages through (spec §8). A miss returns
// undefined so a composite can fall through to the next source. Keyed by id@version;
// PackageKind does not route (package ids are globally unique). Phase 1 defines the
// seam; Phase 2 supplies the composite/caching/cache/registry implementations and
// migrates the resolver onto it. `context` is optional and additive — a source that does
// not care about the consumer ignores it.
export interface IPackageSource
{
    TryGet(ref: PackageRef, context?: PackageResolutionContext): Promise<SourcedPackage | undefined>;
}
