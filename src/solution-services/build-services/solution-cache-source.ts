import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { PackageRef, PackageDocument } from "../../publish/publish.js";
import type { IPackageSource, CompiledPackage } from "./package-source.js";

// A writable package source: TryGet returns the miss/next signal, Put stores.
export interface IWritablePackageSource extends IPackageSource
{
    Put(reference: PackageRef, pkg: CompiledPackage): Promise<void>;
}

// An IStorage-backed cache of compiled packages, laid out as
// `<id>/<version>/model.json` (spec §8.2). Solution-scoped in production; any
// IStorage in tests. Written through by CachingPackageSource.
export class SolutionCacheSource implements IWritablePackageSource
{
    private static readonly ModelFileName = "model.json";

    constructor(private readonly storage: IStorage)
    {
    }

    public async TryGet(reference: PackageRef): Promise<CompiledPackage | undefined>
    {
        const path = SolutionCacheSource.PathOf(reference);
        if (!(await this.storage.Exists(path))) return undefined;
        const document = JSON.parse(await this.storage.ReadText(path)) as PackageDocument;
        return {
            Document: { nodes: document.nodes, edges: document.edges },
            Dependencies: document.dependencies ?? [],
        };
    }

    public async Put(reference: PackageRef, pkg: CompiledPackage): Promise<void>
    {
        const document: PackageDocument = {
            nodes: pkg.Document.nodes,
            edges: pkg.Document.edges,
            dependencies: [...pkg.Dependencies],
        };
        await this.storage.WriteText(SolutionCacheSource.PathOf(reference), JSON.stringify(document));
    }

    private static PathOf(reference: PackageRef): string
    {
        return `${reference.id}/${reference.version}/${SolutionCacheSource.ModelFileName}`;
    }
}
