import { type IStorage } from '@pragmatic-tech-ai/todl-runtime';

// Collision-free storage names. Pure IO over an IStorage; UX-free.
export class UniqueName
{
    // A project-relative name for `fileName` that doesn't collide with an existing
    // entry: returns it as-is when free, else the first free `stem-N.ext` (N >= 2),
    // mirroring an OS "copy" rename. The extension (leading dot only — dotfiles like
    // `.gitignore` keep their whole name) is preserved on the suffix.
    public static async For(storage: IStorage, fileName: string): Promise<string>
    {
        if (!(await storage.Exists(fileName))) return fileName;
        const dot = fileName.lastIndexOf('.');
        const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
        const ext = dot > 0 ? fileName.slice(dot) : '';
        for (let n = 2; ; n++)
        {
            const candidate = `${stem}-${n}${ext}`;
            if (!(await storage.Exists(candidate))) return candidate;
        }
    }
}
