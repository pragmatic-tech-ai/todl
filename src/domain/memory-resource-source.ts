import type { ResourceContent } from "./contributor.js";
import type { ResourceSource } from "./resource-source.js";
import { MimeTypes } from "./mime-types.js";

/** An in-memory ResourceSource keyed by qualified uri — backs the browser bundle
 *  (bytes inlined at build time) and tests. Mirrors MemoryPackageSource. */
export class MemoryResourceSource implements ResourceSource
{
    private readonly byUri = new Map<string, Uint8Array>();

    constructor(entries?: Iterable<readonly [string, Uint8Array]>)
    {
        if (entries !== undefined) for (const [uri, bytes] of entries) this.byUri.set(uri, bytes);
    }

    public Add(uri: string, bytes: Uint8Array): void
    {
        this.byUri.set(uri, bytes);
    }

    public resource(uri: string): Promise<ResourceContent | undefined>
    {
        const bytes = this.byUri.get(uri);
        if (bytes === undefined) return Promise.resolve(undefined);
        return Promise.resolve({ uri, mime: MimeTypes.Of(uri), bytes });
    }
}
