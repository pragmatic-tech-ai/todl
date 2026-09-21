import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";

// Storage-walk utilities the manager uses: CopyAll promotes a sandbox into the kept
// output; Files enumerates produced artifacts for the report. Both walk from the
// storage root ("") depth-first.
export class StorageTree
{
    public static async CopyAll(from: IStorage, to: IStorage): Promise<void>
    {
        await StorageTree.CopyDir(from, to, "");
    }

    public static async Files(storage: IStorage): Promise<readonly string[]>
    {
        const files: string[] = [];
        await StorageTree.CollectFiles(storage, "", files);
        return files.sort();
    }

    private static async CopyDir(from: IStorage, to: IStorage, dir: string): Promise<void>
    {
        for (const entry of await from.List(dir))
        {
            const path = dir === "" ? entry.Name : `${dir}/${entry.Name}`;
            if (entry.IsDirectory)
            {
                await to.CreateDirectory(path);
                await StorageTree.CopyDir(from, to, path);
            }
            else
            {
                await to.WriteBytes(path, await from.ReadBytes(path));
            }
        }
    }

    private static async CollectFiles(storage: IStorage, dir: string, into: string[]): Promise<void>
    {
        for (const entry of await storage.List(dir))
        {
            const path = dir === "" ? entry.Name : `${dir}/${entry.Name}`;
            if (entry.IsDirectory)
            {
                await StorageTree.CollectFiles(storage, path, into);
            }
            else
            {
                into.push(path);
            }
        }
    }
}
