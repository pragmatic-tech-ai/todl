import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type SourceFile } from '../../../compiler-services/diagnostics/span.js'

// Shared TODL source-collection + project-relative path helpers, used by the producer
// factories (publish/compile) and validation. Static methods on one type rather than
// free functions — pure walks over an IStorage, no state.
export class TodlProjectSourceFiles
{
    // Top-level directories that hold build OUTPUT, not source: a producer project's
    // `dist/` is its published artifact tree (a compiled copy of `concepts/` etc.), so
    // walking it as source re-declares every node ("node already exists") and fails the
    // compile. Always skipped at the project root (in every collection mode); a nested
    // `dist/` folder is not special.
    private static readonly BuildOutputDirs: readonly string[] = ['dist']

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
    // (uri = project-relative POSIX path), EXCLUDING top-level build-output folders
    // (`dist/`). This is what check() and publish consume.
    public static Collect(storage: IStorage): Promise<SourceFile[]>
    {
        return TodlProjectSourceFiles.Walk(storage, new Set(TodlProjectSourceFiles.BuildOutputDirs))
    }

    // Collect every `.todl` EXCEPT those under the given TOP-LEVEL folders (default
    // `samples/`, which holds example instances that must never enter the taxonomy
    // compile) and the always-excluded build-output folders (`dist/`). A top-level
    // directory whose name is excluded is skipped whole; nested folders of the same
    // name are not special.
    public static CollectTaxonomy(
        storage: IStorage,
        excludeDirs: readonly string[] = ['samples'],
    ): Promise<SourceFile[]>
    {
        return TodlProjectSourceFiles.Walk(storage, new Set([...excludeDirs, ...TodlProjectSourceFiles.BuildOutputDirs]))
    }

    // The shared walk: every `.todl` under the project, skipping top-level directories
    // whose name is in `excludeTopLevel`.
    private static async Walk(storage: IStorage, excludeTopLevel: ReadonlySet<string>): Promise<SourceFile[]>
    {
        const out: SourceFile[] = []
        const walk = async (dir: string): Promise<void> => {
            for (const e of await storage.List(dir))
            {
                if (dir === '' && e.IsDirectory && excludeTopLevel.has(e.Name)) continue
                const path = TodlProjectSourceFiles.JoinRel(dir, e.Name)
                if (e.IsDirectory) await walk(path)
                else if (TodlProjectSourceFiles.Extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
            }
        }
        await walk('')
        return out
    }
}
