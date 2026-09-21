import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type SourceFile } from '../../../compiler-services/diagnostics/span.js'

// Shared TODL source-collection + project-relative path helpers, used by the producer
// factories (publish/compile) and validation. Static methods on one type rather than
// free functions — pure walks over an IStorage, no state.
export class TodlProjectSourceFiles
{
    public static JoinRel(dir: string, name: string): string
    {
        return dir === '' ? name : dir + '/' + name
    }

    public static Extname(name: string): string
    {
        const i = name.lastIndexOf('.')
        return i > 0 ? name.slice(i).toLowerCase() : ''
    }

    // Recursively collect every `.todl` file in the project as a TODL SourceFile
    // (uri = project-relative POSIX path). This is what check() and publish consume.
    public static async Collect(storage: IStorage): Promise<SourceFile[]>
    {
        const out: SourceFile[] = []
        const walk = async (dir: string): Promise<void> => {
            for (const e of await storage.List(dir))
            {
                const path = TodlProjectSourceFiles.JoinRel(dir, e.Name)
                if (e.IsDirectory) await walk(path)
                else if (TodlProjectSourceFiles.Extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
            }
        }
        await walk('')
        return out
    }

    // Collect every `.todl` EXCEPT those under the given TOP-LEVEL folders (default
    // `samples/`, which holds example instances that must never enter the taxonomy
    // compile). A top-level directory whose name is in excludeDirs is skipped whole;
    // nested folders of the same name are not special.
    public static async CollectTaxonomy(
        storage: IStorage,
        excludeDirs: readonly string[] = ['samples'],
    ): Promise<SourceFile[]>
    {
        const exclude = new Set(excludeDirs)
        const out: SourceFile[] = []
        const walk = async (dir: string): Promise<void> => {
            for (const e of await storage.List(dir))
            {
                if (dir === '' && e.IsDirectory && exclude.has(e.Name)) continue
                const path = TodlProjectSourceFiles.JoinRel(dir, e.Name)
                if (e.IsDirectory) await walk(path)
                else if (TodlProjectSourceFiles.Extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
            }
        }
        await walk('')
        return out
    }
}
