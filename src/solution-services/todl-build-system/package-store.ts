import { ServiceKey, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { PackageRef } from "../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "./package-source.js";
import { SolutionCacheSource } from "./solution-cache-source.js";

// The unified published-package store — replaces the per-kind IProducerStorageBackends
// (package ids are globally unique, so kind no longer routes). Publishing writes each
// package's files under <id>/<version>/ into Storage; resolution reads them back
// through IPackageSource. One store serves both the write (publish) and read (resolve)
// sides.
export interface IPackageStore extends IPackageSource
{
    readonly Storage: IStorage;
}

export const PackageStoreKey = new ServiceKey<IPackageStore>("PackageStore");

// The default store over a single IStorage: reads via the <id>/<version>/model.json
// layout (SolutionCacheSource), writes go through the same Storage under that layout
// (the publish spine's BlobPackageStore computes the <id>/<version>/ prefix).
export class StoragePackageStore implements IPackageStore
{
    private readonly reader: SolutionCacheSource;

    constructor(public readonly Storage: IStorage)
    {
        this.reader = new SolutionCacheSource(Storage);
    }

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        return this.reader.TryGet(reference);
    }
}
