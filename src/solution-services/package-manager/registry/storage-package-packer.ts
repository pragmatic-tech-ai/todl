/**
 * `StoragePackagePacker` — packs an already-staged {@link IStorage} package layout (a
 * build's Sandbox) into a {@link PublishablePackage}: every file under the layout
 * tar+gzips under `package/`, and the top-level package.json is parsed as the manifest.
 * Browser-safe (no node builtins — gzip via `WebTgz`), so the publish build action runs
 * in a renderer over any `IStorage`, including in-memory ones. The filesystem-directory
 * counterpart stays on the node-only `PackageRegistryClient.publish(dir)`.
 */
import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { StorageTree } from "../../build-system-core/storage-tree.js";
import type { PackageManifestJson, PublishablePackage } from "../engine/package-registry.js";
import type { TarEntry } from "./tar-archive.js";
import { WebTgz } from "./web-tgz.js";

export class StoragePackagePacker
{
    private static readonly PackageJsonName = "package.json";
    private static readonly PackagePrefix = "package/";
    private static readonly NoManifestMessage = "no package.json in build output";

    private static readonly Decoder = new TextDecoder();

    public static async Pack(layout: IStorage): Promise<PublishablePackage>
    {
        const entries: TarEntry[] = [];
        let manifest: PackageManifestJson | undefined;
        for (const path of await StorageTree.Files(layout))
        {
            const bytes = await layout.ReadBytes(path);
            if (path === StoragePackagePacker.PackageJsonName)
            {
                manifest = JSON.parse(StoragePackagePacker.Decoder.decode(bytes)) as PackageManifestJson;
            }
            entries.push({ path: `${StoragePackagePacker.PackagePrefix}${path}`, bytes });
        }
        if (manifest === undefined) throw new Error(StoragePackagePacker.NoManifestMessage);
        return { Manifest: manifest, Tarball: await WebTgz.Create(entries) };
    }
}
