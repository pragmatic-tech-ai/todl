import type { ArtifactKey } from "./artifact-key.js";

// The typed hot-value bag threaded across a build's actions, keyed by ArtifactKey
// identity. The rule (spec §2.2): an action must be correct reading only files in
// Project/Sandbox; the bag is an optimization that lets a downstream action skip
// re-reading a file, never the sole channel.
export class BuildArtifacts
{
    private readonly values = new Map<ArtifactKey<unknown>, unknown>();

    public Set<T>(key: ArtifactKey<T>, value: T): void
    {
        this.values.set(key, value);
    }

    public Get<T>(key: ArtifactKey<T>): T | undefined
    {
        return this.values.get(key) as T | undefined;
    }
}
