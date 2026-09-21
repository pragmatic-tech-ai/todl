import type { IPackageRegistry } from "../package-manager/engine/package-registry.js";
import { DEFAULT_SCOPE } from "../package-manager/package-json.js";
import { TarReader } from "../package-manager/registry/tar-reader.js";
import type { PackageDocument, PackageRef } from "../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "./package-source.js";

// The terminal source of the resolution chain (spec §8.2): fetches a compiled package
// from an external registry. A bare todl id is mapped to its scoped npm name
// (`<scope>/<id>`); the fetched tarball is parsed by TarReader and its model.json becomes
// the SourcedPackage. Any miss — the package is unpublished (GetContent rejects) or the
// tarball is not a TODL package — returns undefined so a CompositePackageSource above can
// fall through. It is read-only; a CachingPackageSource decorator handles population.
export class RegistrySource implements IPackageSource
{
    constructor(
        private readonly registry: IPackageRegistry,
        private readonly scope: string = DEFAULT_SCOPE,
    )
    {
    }

    public async TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        const name = `${this.scope}/${reference.id}`;
        const bytes = await this.Fetch(name, reference.version);
        if (bytes === undefined) return undefined;

        const installed = TarReader.readPackage(bytes);
        if (installed === undefined) return undefined; // a non-TODL npm package

        const document = installed.document as PackageDocument;
        return {
            Document: { nodes: document.nodes, edges: document.edges },
            Dependencies: document.dependencies ?? [],
        };
    }

    // Fetch a tarball by scoped name + version; a rejection (a 404 / unpublished package)
    // is a miss, not a build failure — the caller falls through to the next source.
    private async Fetch(name: string, version: string): Promise<Uint8Array | undefined>
    {
        try
        {
            return await this.registry.GetContent({ name, version });
        }
        catch
        {
            return undefined;
        }
    }
}
