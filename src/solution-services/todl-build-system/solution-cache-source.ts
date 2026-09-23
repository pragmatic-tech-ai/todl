import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { PackageRef, PackageDocument, PackageResource } from "../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "./package-source.js";

// A writable package source: TryGet returns the miss/next signal, Put stores.
export interface IWritablePackageSource extends IPackageSource
{
    Put(reference: PackageRef, pkg: SourcedPackage): Promise<void>;
}

// An IStorage-backed cache of compiled packages, laid out as
// `<id>/<version>/model.json` (spec §8.2). Solution-scoped in production; any
// IStorage in tests. Written through by CachingPackageSource.
export class SolutionCacheSource implements IWritablePackageSource
{
    private static readonly ModelFileName = "model.json";
    private static readonly SrcDir = "src";

    constructor(private readonly storage: IStorage)
    {
    }

    public async TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        const path = SolutionCacheSource.PathOf(reference);
        if (!(await this.storage.Exists(path))) return undefined;
        const document = JSON.parse(await this.storage.ReadText(path)) as PackageDocument;
        const base = SolutionCacheSource.BaseOf(reference);
        const resources = await SolutionCacheSource.ReadResources(this.storage, base);
        const sourced: SourcedPackage = {
            Document: { nodes: document.nodes, edges: document.edges },
            Dependencies: document.dependencies ?? [],
        };
        if (resources.length > 0) sourced.resources = resources;
        return sourced;
    }

    public async Put(reference: PackageRef, pkg: SourcedPackage): Promise<void>
    {
        const document: PackageDocument = {
            nodes: pkg.Document.nodes,
            edges: pkg.Document.edges,
            dependencies: [...pkg.Dependencies],
        };
        const base = SolutionCacheSource.BaseOf(reference);
        await this.storage.WriteText(SolutionCacheSource.PathOf(reference), JSON.stringify(document));
        for (const r of pkg.resources ?? []) await this.storage.WriteBytes(`${base}/${r.path}`, r.bytes);
    }

    // Enumerate every persisted file under the package base except model.json and the src/
    // tree (sources), returning package-relative { path, bytes } resources.
    private static async ReadResources(storage: IStorage, base: string): Promise<PackageResource[]>
    {
        const out: PackageResource[] = [];
        const walk = async (dir: string, rel: string): Promise<void> =>
        {
            for (const e of await storage.List(dir))
            {
                const childRel = rel === "" ? e.Name : `${rel}/${e.Name}`;
                if (e.IsDirectory)
                {
                    if (childRel !== SolutionCacheSource.SrcDir) await walk(`${dir}/${e.Name}`, childRel);
                    continue;
                }
                if (childRel === SolutionCacheSource.ModelFileName) continue;
                out.push({ path: childRel, bytes: await storage.ReadBytes(`${dir}/${e.Name}`) });
            }
        };
        await walk(base, "");
        return out;
    }

    private static BaseOf(reference: PackageRef): string
    {
        return `${reference.id}/${reference.version}`;
    }

    private static PathOf(reference: PackageRef): string
    {
        return `${SolutionCacheSource.BaseOf(reference)}/${SolutionCacheSource.ModelFileName}`;
    }
}
