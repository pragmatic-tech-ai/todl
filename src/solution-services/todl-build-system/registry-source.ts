import type { IPackageRegistry } from "../package-manager/engine/package-registry.js";
import { DEFAULT_SCOPE } from "../package-manager/package-json.js";
import { TarReader, type TarFile } from "../package-manager/registry/tar-reader.js";
import type { PackageDocument, PackageRef, PackageResource } from "../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "./package-source.js";

// The terminal source of the resolution chain (spec §8.2): fetches a compiled package
// from an external registry. A bare todl id is mapped to its scoped npm name
// (`<scope>/<id>`); the fetched tarball is parsed by TarReader and its model.json becomes
// the SourcedPackage. Any miss — the package is unpublished (GetContent rejects) or the
// tarball is not a TODL package — returns undefined so a CompositePackageSource above can
// fall through. It is read-only; a CachingPackageSource decorator handles population.
export class RegistrySource implements IPackageSource
{
    private static readonly Prefix = "package/";
    private static readonly ModelFile = "package/model.json";
    private static readonly PackageJsonFile = "package/package.json";
    private static readonly SrcPrefix = "package/src/";

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

        const files: TarFile[] = TarReader.read(bytes);
        const byPath = new Map(files.map((f) => [f.path, f.bytes]));
        const modelBytes = byPath.get(RegistrySource.ModelFile);
        if (modelBytes === undefined || !byPath.has(RegistrySource.PackageJsonFile)) return undefined; // a non-TODL npm package

        const document = JSON.parse(new TextDecoder().decode(modelBytes)) as PackageDocument;
        const resources: PackageResource[] = files
            .filter((f) => f.path.startsWith(RegistrySource.Prefix)
                && f.path !== RegistrySource.ModelFile
                && f.path !== RegistrySource.PackageJsonFile
                && !f.path.startsWith(RegistrySource.SrcPrefix))
            .map((f) => ({ path: f.path.slice(RegistrySource.Prefix.length), bytes: f.bytes }));

        const sourced: SourcedPackage = {
            Document: { nodes: document.nodes, edges: document.edges },
            Dependencies: document.dependencies ?? [],
        };
        if (resources.length > 0) sourced.resources = resources;
        return sourced;
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
