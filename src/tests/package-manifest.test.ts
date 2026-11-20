import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface IPackageManifest
{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// Mural is a peer of todl: a regular dependency nests a second Mural copy in every consumer, and a devDependency
// beside the peer would let a consumer's `npm prune --omit=dev` strip todl's own installed copy (the package root
// barrel loads mural at module load, so the peer is required, not optional).
class PackageManifest
{
    private static readonly ManifestPath = "../../package.json";
    private static readonly MuralPackage = "@pragmatic-tech-ai/mural";
    private static readonly Encoding = "utf8";

    public static Read(): IPackageManifest
    {
        const path = fileURLToPath(new URL(PackageManifest.ManifestPath, import.meta.url));
        return JSON.parse(readFileSync(path, PackageManifest.Encoding)) as IPackageManifest;
    }

    public static get Mural(): string
    {
        return PackageManifest.MuralPackage;
    }
}

describe("package manifest", () =>
{
    const manifest = PackageManifest.Read();

    it("declares mural as a peer dependency", () =>
    {
        assert.ok(manifest.peerDependencies?.[PackageManifest.Mural]);
    });

    it("does not declare mural as a regular or dev dependency", () =>
    {
        assert.equal(manifest.dependencies?.[PackageManifest.Mural], undefined);
        assert.equal(manifest.devDependencies?.[PackageManifest.Mural], undefined);
    });

    it("keeps the mural peer required", () =>
    {
        assert.notEqual(manifest.peerDependenciesMeta?.[PackageManifest.Mural]?.optional, true);
    });
});
