import {
    ServiceBase, compareStorageEntries,
    type IServiceProvider, type IStorage,
} from '@pragmatic-tech-ai/todl-runtime'
import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from './project-factory.js'
import { type BaseBindings } from './base-binding.js'
import { Project, ProjectNode, ProjectNodeKind } from './project.js'
import { TODL_MANUAL_SOURCE, TODL_RULES_SOURCE } from './scaffold.generated.js'

// The base for every TODL-authoring project type. It owns the whole project
// lifecycle common to architecture / meta-model / library — manifest write+read,
// the storage-tree walk, and the agent-support scaffold — leaving each subclass to
// declare only its manifest shape, its file formats, and its own scaffold files.
// Persistence flows through the rooted IStorage (project-relative paths).

export const CLAUDE_MD_FILENAME = 'CLAUDE.md'
export const CLAUDE_DIR = '.claude'

export interface ScaffoldFile {
    readonly path: string       // project-relative destination (POSIX)
    readonly content: string
}

// The shared scaffold every TODL project receives: the language manual and the
// golden-rules digest, both under .claude/. The content is embedded as generated
// string constants (scaffold.generated.ts) so it survives headless bundling — the
// .md files under scaffold/ stay the source of truth (run `npm run gen:scaffold`).
// Subclasses add their own CLAUDE.md and type-specific guides via scaffoldContributions().
export const TODL_BASE_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: `${CLAUDE_DIR}/todl-manual.md`, content: TODL_MANUAL_SOURCE },
    { path: `${CLAUDE_DIR}/todl-rules.md`, content: TODL_RULES_SOURCE },
]

export abstract class TodlProjectFactory extends ServiceBase implements IProjectFactory {
    constructor(provider: IServiceProvider) { super(provider) }

    // Self-describing type metadata (§ IProjectFactory) — each subclass supplies its
    // stable id and the New-Project gallery display strings.
    public abstract readonly typeId: string
    public abstract readonly title: string
    public abstract readonly description: string

    // Each subclass declares its openable formats; populate derives node kinds from them.
    public abstract readonly formats: readonly ProjectFileFormat[]

    // Build the initial manifest object to serialize on create — the subclass's
    // extended shape (id/modelVersion, id/libVersion/metaModel, metaModel/libraries).
    protected abstract buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope

    // The subclass's own scaffold files (its CLAUDE.md + any type-specific guides),
    // unioned with TODL_BASE_SCAFFOLD by ensureScaffold.
    protected abstract scaffoldContributions(): readonly ScaffoldFile[]

    public async createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project> {
        const manifest = this.buildManifest(name, bindings)
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        await this.ensureScaffold(storage)
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project> {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        await this.ensureScaffold(storage)          // self-heal any missing scaffold file
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void> {
        // Only the name tracks the project; every other manifest field is preserved.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Write base ∪ subclass scaffold, each only when absent — never overwrites an
    // author's edits.
    protected async ensureScaffold(storage: IStorage): Promise<void> {
        await storage.CreateDirectory(`${CLAUDE_DIR}/commands`)
        for (const file of [...TODL_BASE_SCAFFOLD, ...this.scaffoldContributions()]) {
            if (await storage.Exists(file.path)) continue
            await storage.WriteText(file.path, file.content)
        }
    }

    // Refresh the scaffold to the current bundled content: overwrite every entry
    // except the author-owned root CLAUDE.md (which is only written when missing).
    // Mirrors ensureScaffold's file set; returns the project-relative paths written
    // (refreshed or self-healed) for a status report. ensureScaffold stays write-once
    // and unchanged — this is the deliberate-refresh counterpart.
    public async updateScaffold(storage: IStorage): Promise<readonly string[]> {
        await storage.CreateDirectory(`${CLAUDE_DIR}/commands`)
        const written: string[] = []
        for (const file of [...TODL_BASE_SCAFFOLD, ...this.scaffoldContributions()]) {
            if (file.path === CLAUDE_MD_FILENAME && await storage.Exists(file.path)) continue
            await storage.WriteText(file.path, file.content)
            written.push(file.path)
        }
        return written
    }

    protected async buildProject(storage: IStorage, manifest: ProjectManifestEnvelope): Promise<Project> {
        const rootName = TodlProjectFactory.basename(storage.Root)
        const root = new ProjectNode(rootName, '', ProjectNodeKind.Folder)     // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node from storage. The manifest file is hidden at the
    // root; node kinds come from the subclass's formats. Paths are project-relative
    // (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void> {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = node.Path === '' ? e.Name : `${node.Path}/${e.Name}`
            const kind: ProjectNodeKind = e.IsDirectory ? ProjectNodeKind.Folder : this.kindForFile(e.Name)
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }

    // Map a file name to a ProjectNodeKind by matching its extension against the
    // subclass's declared formats; unmatched files are plain File attachments.
    private kindForFile(name: string): ProjectNodeKind {
        const ext = TodlProjectFactory.extname(name)
        const fmt = this.formats.find((f) => f.extension === ext)
        // Format kinds are the ProjectNodeKind string values ('todl'/'diagram'); the
        // cast bridges the plain-string format field to the node's enum Kind.
        return fmt !== undefined ? (fmt.kind as ProjectNodeKind) : ProjectNodeKind.File
    }

    private static basename(p: string): string {
        const parts = p.split(/[\\/]/)
        return parts[parts.length - 1] || p
    }

    private static extname(name: string): string {
        const i = name.lastIndexOf('.')
        return i > 0 ? name.slice(i).toLowerCase() : ''
    }
}

// Type guard: is this factory a TODL-authoring project (and thus carries the agent
// scaffold updateScaffold refreshes)? All three concrete factories extend
// TodlProjectFactory, so instanceof is exact.
export function isTodlProject(factory: IProjectFactory): factory is TodlProjectFactory {
    return factory instanceof TodlProjectFactory
}
