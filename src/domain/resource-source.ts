import type { ResourceContent } from "./contributor.js";

/** A capability: resolve a package resource's bytes by its qualified uri
 *  (`<model>/<version>/<path>`). Distinct from PackageSource (which resolves packages);
 *  a source may implement one, the other, or both. */
export interface ResourceSource
{
    resource(uri: string): Promise<ResourceContent | undefined>;
}
