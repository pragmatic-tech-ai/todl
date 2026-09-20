import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type PackageSink } from '../../../publish/stores.js'

// Adapts the project IStorage to TODL's PackageSink so publish can write a bundle's
// model.json + src/ through it — the small consumer adapter TODL's publish design
// leaves to the host (mirrors the FileIO seam).
export class StoragePackageSink implements PackageSink
{
    constructor(private readonly storage: IStorage) {}

    writeText(path: string, content: string): Promise<void> { return this.storage.WriteText(path, content) }
    writeBytes(path: string, bytes: Uint8Array): Promise<void> { return this.storage.WriteBytes(path, bytes) }
}
