/** Infer a resource's mime type from its path extension (for data-URI / HTTP serving). */
export class MimeTypes
{
    private static readonly Default = "application/octet-stream";
    private static readonly ByExtension: ReadonlyMap<string, string> = new Map([
        [".svg", "image/svg+xml"],
        [".png", "image/png"],
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".gif", "image/gif"],
        [".webp", "image/webp"],
        [".md", "text/markdown"],
        [".json", "application/json"],
        [".txt", "text/plain"],
    ]);

    /** Infer a mime type from a path's extension; unknown → application/octet-stream. */
    public static Of(path: string): string
    {
        const dot = path.lastIndexOf(".");
        if (dot < 0) return MimeTypes.Default;
        return MimeTypes.ByExtension.get(path.slice(dot).toLowerCase()) ?? MimeTypes.Default;
    }
}
