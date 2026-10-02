import { type IStorage, type StorageEntry } from '@pragmatic-tech-ai/todl-runtime';

// An IStorage decorator that drops the leading npm scope segment (`@scope/`)
// from every path before delegating — a scoped publish lands at the bare-id
// path that local resolution reads ("resolution never keys off scope").
export class ScopeFlatteningStorage implements IStorage
{
    private static readonly ScopePrefix = '@';
    private static readonly Separator = '/';

    constructor(private readonly inner: IStorage)
    {
    }

    public get Root(): string { return this.inner.Root; }
    public ReadText(path: string): Promise<string> { return this.inner.ReadText(ScopeFlatteningStorage.Flatten(path)); }
    public ReadBytes(path: string): Promise<Uint8Array> { return this.inner.ReadBytes(ScopeFlatteningStorage.Flatten(path)); }
    public WriteText(path: string, content: string): Promise<void> { return this.inner.WriteText(ScopeFlatteningStorage.Flatten(path), content); }
    public WriteBytes(path: string, bytes: Uint8Array): Promise<void> { return this.inner.WriteBytes(ScopeFlatteningStorage.Flatten(path), bytes); }
    public Exists(path: string): Promise<boolean> { return this.inner.Exists(ScopeFlatteningStorage.Flatten(path)); }
    public Delete(path: string): Promise<void> { return this.inner.Delete(ScopeFlatteningStorage.Flatten(path)); }
    public CreateDirectory(path: string): Promise<void> { return this.inner.CreateDirectory(ScopeFlatteningStorage.Flatten(path)); }
    public Rename(from: string, to: string): Promise<void> { return this.inner.Rename(ScopeFlatteningStorage.Flatten(from), ScopeFlatteningStorage.Flatten(to)); }
    public List(path: string): Promise<readonly StorageEntry[]> { return this.inner.List(ScopeFlatteningStorage.Flatten(path)); }

    private static Flatten(path: string): string
    {
        if (!path.startsWith(ScopeFlatteningStorage.ScopePrefix)) return path;
        const slash = path.indexOf(ScopeFlatteningStorage.Separator);
        if (slash < 0) return path;
        return path.slice(slash + 1);
    }
}
