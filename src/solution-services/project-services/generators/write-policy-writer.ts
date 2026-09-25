/**
 * Applies a `WritePolicy` to a single `IStorage` write: overwrite unconditionally,
 * write only if the path is absent, or preserve hand edits by checking a marker
 * on the file's first line before overwriting.
 */

import { type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { WritePolicy } from "./project-content-generator.js";

export class WritePolicyWriter
{
    /** Returns true if it wrote, false if the policy caused a skip. */
    public static async Write(
        storage: IStorage, path: string, content: string,
        policy: WritePolicy, marker?: string): Promise<boolean>
    {
        if (policy === WritePolicy.WriteOnce && await storage.Exists(path)) return false;
        if (policy === WritePolicy.PreserveHandEdits && await storage.Exists(path))
        {
            const first = (await storage.ReadText(path)).split("\n")[0];
            if (marker !== undefined && first !== marker) return false;
        }
        await storage.WriteText(path, content);
        return true;
    }
}
