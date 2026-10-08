import {
    type IStorage, compareStorageEntries,
    isStatStorage, isWatchableStorage, FileChangeKind, type FileChange,
} from '@pragmatic-tech-ai/todl-runtime'
import { ProjectNodeKind } from '../core/project.js'
import { PROJECT_MANIFEST_FILENAME } from '../core/project-factory.js'
import { ProjectContentNode, type ContentNodeId } from './content-node.js'
import { ContentAdded, ContentRemoved, ContentUpdated, type ContentChange } from './content-change.js'

interface FolderState
{
    loaded: boolean
    loading?: Promise<void> | undefined
    readonly children: Map<ContentNodeId, ProjectContentNode>   // insertion = child set
    readonly byPath: Map<string, ContentNodeId>
    readonly byIno: Map<string, ContentNodeId>                  // 'dev:ino' -> id (nonzero ino only)
    readonly sinks: Set<(c: ContentChange) => void>
    watchOff?: (() => void) | undefined
    // Buffered adds + removals awaiting rename correlation within the settle window.
    // Both are buffered so a rename correlates regardless of which event the OS emits
    // first (Windows chokidar reports the add before the unlink).
    readonly pendingRemovals: Map<string, { id: ContentNodeId; inoKey: string; isDir: boolean }>
    readonly pendingAdds: Map<string, { inoKey: string; isDir: boolean }>
    timer?: ReturnType<typeof setTimeout> | undefined
}

// A reactive, lazy per-project content store over an IStorage: enumerates a folder
// one level on first subscribe (realize = subscribe), mints stable ids, and hands
// children out as ContentChange deltas. Watching + reconciliation is layered on in
// a later slice; this core is the keyed identity + lazy load.
export class ProjectContentStore
{
    private static readonly RootPath = ''
    private static readonly InvalidNameMessage = 'Invalid name'
    // Root-level files the content tree never surfaces: the project manifest
    // (`project.plexus`) is the project — it is already represented by the project's
    // own logical node, so showing it as a child file is redundant and inviting to
    // edit/delete by hand. Only the ROOT entry is hidden; a same-named file nested in
    // a subfolder (not the manifest) still appears.
    private static readonly HiddenRootFiles: ReadonlySet<string> = new Set([PROJECT_MANIFEST_FILENAME])
    private static readonly DiagramExts = ['.archdiagram', '.diagram']
    // Rename correlation window. Sized to bridge the gap between a rename's add and
    // unlink events (measured ~107ms on Windows chokidar); a new/removed file surfaces
    // after this delay, and events within one window batch into a single flush.
    private static readonly DefaultSettleMs = 250
    private readonly settleMs: number
    private disposed = false
    private nextId = 1
    private readonly folders = new Map<ContentNodeId, FolderState>()   // folder id -> its state
    private readonly nodeById = new Map<ContentNodeId, ProjectContentNode>()
    private readonly pathById = new Map<ContentNodeId, string>()       // folder id -> its project path
    public readonly Root: ProjectContentNode

    constructor(private readonly storage: IStorage, options?: { settleMs?: number })
    {
        this.settleMs = options?.settleMs ?? ProjectContentStore.DefaultSettleMs
        this.Root = new ProjectContentNode(this.mintId(), ProjectContentStore.RootPath, '', ProjectNodeKind.Folder)
        this.pathById.set(this.Root.Id, ProjectContentStore.RootPath)
    }

    public ObserveChildren(folder: ContentNodeId, sink: (c: ContentChange) => void): () => void
    {
        const state = this.stateFor(folder)
        state.sinks.add(sink)
        if (!state.loaded && state.loading === undefined) { state.loading = this.load(folder, state) }
        else if (state.loaded) { for (const node of state.children.values()) sink(new ContentAdded(node)) }
        // else: a load is in flight — it emits ContentAdded to every current sink,
        // including this one, so a concurrent subscriber neither re-loads nor double-emits.
        return () =>
        {
            state.sinks.delete(sink)
            if (state.sinks.size > 0) return;
            if (state.watchOff !== undefined) { state.watchOff(); state.watchOff = undefined }
            if (state.timer !== undefined) { clearTimeout(state.timer); state.timer = undefined }
            // Last observer left: drop the watcher and mark unloaded so a re-subscribe
            // re-Lists (catching changes missed while collapsed) and restarts the watcher.
            // The id maps (byPath/byIno) are kept so re-realized children keep their ids.
            state.loaded = false
            state.loading = undefined
        }
    }

    public dispose(): void
    {
        // Guard first so an in-flight fs-change callback (its inode lookup awaits, then
        // schedules) cannot arm a new settle timer after teardown; then drop watchers and
        // cancel any already-scheduled flush.
        this.disposed = true
        for (const s of this.folders.values())
        {
            s.watchOff?.(); s.watchOff = undefined
            if (s.timer !== undefined) { clearTimeout(s.timer); s.timer = undefined }
        }
    }

    // Test seam: await any in-flight folder load so assertions need no sleeps.
    public async WhenIdle(): Promise<void>
    {
        for (const s of this.folders.values()) await s.loading
    }

    public NodeById(id: ContentNodeId): ProjectContentNode | undefined
    {
        return this.nodeById.get(id)
    }

    // Mutations. Writes flow UI → store → disk → watcher delta → tree: the store never
    // optimistically mutates its own model, so a failed IStorage call (e.g. an FS
    // collision throwing from Rename) leaves the tree unchanged and the row reverts.
    //
    // These are the ENGINE-level mutation API (headless / devUI). The Plexus desktop UI
    // does NOT call them directly: it routes through ProjectExplorerService, which layers
    // the delete confirmation, the open-document close-guard, and open-editor relocation
    // on top before hitting storage. Both paths ultimately mutate the same IStorage, so
    // the same watcher delta feeds the tree either way.
    public async CreateFile(parentId: ContentNodeId, name: string, content = ''): Promise<void>
    {
        await this.storage.WriteText(this.childPath(parentId, name), content)
    }

    public async CreateFolder(parentId: ContentNodeId, name: string): Promise<void>
    {
        await this.storage.CreateDirectory(this.childPath(parentId, name))
    }

    public async Rename(id: ContentNodeId, newName: string): Promise<void>
    {
        if (newName === '' || newName.includes('/')) throw new Error(ProjectContentStore.InvalidNameMessage)
        const path = this.pathOf(id)
        if (path === undefined) return
        const dir = ProjectContentStore.parentDir(path)
        const target = dir === '' ? newName : `${dir}/${newName}`
        if (target === path) return
        await this.storage.Rename(path, target)   // watcher + settle reconciliation → ContentUpdated (same id)
    }

    public async Delete(id: ContentNodeId): Promise<void>
    {
        const path = this.pathOf(id)
        if (path !== undefined) await this.storage.Delete(path)
    }

    public async Move(ids: readonly ContentNodeId[], destFolderId: ContentNodeId): Promise<void>
    {
        const dest = this.pathById.get(destFolderId) ?? this.pathOf(destFolderId) ?? ''
        for (const id of ids)
        {
            const path = this.pathOf(id)
            if (path === undefined) continue
            const target = dest === '' ? ProjectContentStore.baseName(path) : `${dest}/${ProjectContentStore.baseName(path)}`
            if (target !== path) await this.storage.Rename(path, target)
        }
    }

    // Project-relative parent directory of a path ('' for a root-level entry). Public so
    // the Plexus FileTreeContributor can resolve a node's containing folder.
    public static parentDir(path: string): string
    {
        const i = path.lastIndexOf('/')
        return i === -1 ? '' : path.slice(0, i)
    }

    private childPath(parentId: ContentNodeId, name: string): string
    {
        const dir = this.pathById.get(parentId) ?? this.pathOf(parentId) ?? ''
        return dir === '' ? name : `${dir}/${name}`
    }

    private pathOf(id: ContentNodeId): string | undefined
    {
        if (id === this.Root.Id) return ProjectContentStore.RootPath
        return this.nodeById.get(id)?.Path
    }

    private stateFor(folder: ContentNodeId): FolderState
    {
        let s = this.folders.get(folder)
        if (s === undefined)
        {
            s = { loaded: false, children: new Map(), byPath: new Map(), byIno: new Map(), sinks: new Set(), pendingRemovals: new Map(), pendingAdds: new Map() }
            this.folders.set(folder, s)
        }
        return s
    }

    private async load(folder: ContentNodeId, state: FolderState): Promise<void>
    {
        const dirPath = this.pathById.get(folder) ?? ProjectContentStore.RootPath
        const entries = [...await this.storage.List(dirPath)].sort(compareStorageEntries)
        const seen = new Set<string>()
        for (const entry of entries)
        {
            const childPath = dirPath === '' ? entry.Name : `${dirPath}/${entry.Name}`
            if (ProjectContentStore.isHiddenEntry(childPath)) continue
            seen.add(childPath)
            const node = this.internChild(state, childPath, entry.Name, ProjectContentStore.kindOf(entry.Name, entry.IsDirectory))
            const inoKey = await this.inoKeyFor(childPath)
            if (inoKey !== '') state.byIno.set(inoKey, node.Id)
            for (const sink of [...state.sinks]) sink(new ContentAdded(node))
        }
        // Re-list catch-up: drop children that vanished while this folder was unwatched.
        // Silent (no ContentRemoved) — a fresh post-collapse subscriber never saw their add.
        for (const [path, id] of [...state.byPath])
        {
            if (seen.has(path)) continue
            state.byPath.delete(path)
            state.children.delete(id)
            this.dropSubtree(id)
        }
        state.loaded = true
        if (isWatchableStorage(this.storage))
        {
            state.watchOff = this.storage.Watch(dirPath, (c) => { void this.onFileChange(state, c) })
        }
    }

    // Reconcile a raw fs event into a ContentChange. A Removed is buffered for the
    // settle window so a following Added with the same inode+kind is recognised as a
    // rename (ContentUpdated, stable id) rather than remove+add.
    private async onFileChange(state: FolderState, c: FileChange): Promise<void>
    {
        if (c.Kind === FileChangeKind.Removed)
        {
            const id = state.byPath.get(c.Path)
            if (id === undefined) return
            const node = state.children.get(id)!
            state.pendingRemovals.set(c.Path, { id, inoKey: this.inoKeyForNode(state, id), isDir: node.Kind === ProjectNodeKind.Folder })
            this.scheduleFlush(state)
            return
        }
        if (c.Kind === FileChangeKind.Added)
        {
            if (ProjectContentStore.isHiddenEntry(c.Path)) return
            const inoKey = await this.inoKeyFor(c.Path)
            state.pendingAdds.set(c.Path, { inoKey, isDir: c.IsDirectory })
            this.scheduleFlush(state)
            return
        }
        // Changed: content-only; the P1 tree surfaces Name/Kind only → no delta.
    }

    // A buffered removal matching this add by inode+kind — a rename, whichever event
    // the OS emitted first. '' inode cannot correlate (returns undefined → plain add).
    private matchPendingRemoval(state: FolderState, inoKey: string, isDir: boolean): { path: string; id: ContentNodeId } | undefined
    {
        if (inoKey === '') return undefined
        for (const [path, p] of state.pendingRemovals)
        {
            if (p.inoKey === inoKey && p.isDir === isDir) return { path, id: p.id }
        }
        return undefined
    }

    // At settle-window end, pair buffered adds to buffered removals by inode+kind
    // (renames → ContentUpdated, id preserved); unpaired adds → ContentAdded; unpaired
    // removals → ContentRemoved. Order-independent, so add-before-unlink is handled.
    private scheduleFlush(state: FolderState): void
    {
        if (this.disposed || state.timer !== undefined) return
        const flush = (): void =>
        {
            state.timer = undefined
            // Pass 1: pair adds to removals by inode+kind → renames (id preserved).
            for (const [addPath, add] of [...state.pendingAdds])
            {
                const match = this.matchPendingRemoval(state, add.inoKey, add.isDir)
                if (match === undefined) continue
                state.pendingAdds.delete(addPath)
                state.pendingRemovals.delete(match.path)
                const node = state.children.get(match.id)!
                const oldPath = node.Path
                state.byPath.delete(oldPath)
                node.Name = ProjectContentStore.baseName(addPath)
                node.Path = addPath
                state.byPath.set(addPath, match.id)
                if (add.inoKey !== '') state.byIno.set(add.inoKey, match.id)
                // A folder moved: rewrite its subtree's paths and re-point watchers to the
                // new location, so descendants aren't stale and live updates keep flowing.
                if (node.Kind === ProjectNodeKind.Folder) this.renameSubtree(match.id, oldPath, addPath)
                for (const sink of [...state.sinks]) sink(new ContentUpdated(node))
            }
            // Pass 2: unmatched removals → ContentRemoved (frees their paths before pass 3).
            for (const [path, p] of [...state.pendingRemovals])
            {
                state.pendingRemovals.delete(path)
                state.children.delete(p.id)
                state.byPath.delete(path)
                if (p.inoKey !== '') state.byIno.delete(p.inoKey)
                // Recursively tear down the removed subtree (descendant watchers + nodes),
                // then emit the removal for the node itself.
                this.dropSubtree(p.id)
                for (const sink of [...state.sinks]) sink(new ContentRemoved(p.id))
            }
            // Pass 3: unmatched adds → ContentAdded.
            for (const [addPath, add] of [...state.pendingAdds])
            {
                state.pendingAdds.delete(addPath)
                const node = this.internChild(state, addPath, ProjectContentStore.baseName(addPath), ProjectContentStore.kindOf(ProjectContentStore.baseName(addPath), add.isDir))
                if (add.inoKey !== '') state.byIno.set(add.inoKey, node.Id)
                for (const sink of [...state.sinks]) sink(new ContentAdded(node))
            }
        }
        state.timer = setTimeout(flush, this.settleMs)
    }

    // Recursively tear down a subtree's realized state: this node's global entries plus,
    // if it is an expanded folder, its watcher and every descendant. Used on folder
    // removal and on re-list catch-up for vanished children.
    private dropSubtree(id: ContentNodeId): void
    {
        this.nodeById.delete(id)
        this.pathById.delete(id)
        const sub = this.folders.get(id)
        if (sub === undefined) return
        sub.watchOff?.()
        sub.watchOff = undefined
        this.folders.delete(id)
        for (const childId of [...sub.children.keys()]) this.dropSubtree(childId)
    }

    // A folder moved oldPath → newPath: re-point its watcher and rewrite the paths of its
    // already-realized descendants (prefix swap), recursing into expanded subfolders. The
    // folder node's own Path/parent byPath were already updated by the caller.
    private renameSubtree(id: ContentNodeId, oldPath: string, newPath: string): void
    {
        this.pathById.set(id, newPath)
        const sub = this.folders.get(id)
        if (sub === undefined) return
        if (sub.watchOff !== undefined) { sub.watchOff(); sub.watchOff = undefined }
        if (isWatchableStorage(this.storage)) sub.watchOff = this.storage.Watch(newPath, (c) => { void this.onFileChange(sub, c) })
        const rewritten = new Map<string, ContentNodeId>()
        for (const [childPath, childId] of sub.byPath)
        {
            const childNew = newPath + childPath.slice(oldPath.length)   // childPath === oldPath + '/' + rest
            const childNode = sub.children.get(childId)!
            childNode.Path = childNew
            rewritten.set(childNew, childId)
            if (childNode.Kind === ProjectNodeKind.Folder) this.renameSubtree(childId, childPath, childNew)
        }
        sub.byPath.clear()
        for (const [p, i] of rewritten) sub.byPath.set(p, i)
    }

    private async inoKeyFor(path: string): Promise<string>
    {
        if (!isStatStorage(this.storage)) return ''
        const st = await this.storage.Stat(path)
        return st.Ino === '' ? '' : `${st.Dev}:${st.Ino}`
    }

    private inoKeyForNode(state: FolderState, id: ContentNodeId): string
    {
        for (const [k, v] of state.byIno) if (v === id) return k
        return ''
    }

    private static baseName(path: string): string
    {
        const i = path.lastIndexOf('/')
        return i === -1 ? path : path.slice(i + 1)
    }

    // A root-level entry the tree hides (today: the project manifest). Root-level means
    // no path separator — a nested same-named file is a real content node and stays.
    private static isHiddenEntry(path: string): boolean
    {
        return !path.includes('/') && ProjectContentStore.HiddenRootFiles.has(path)
    }

    // Mint-or-reuse a child node by path (a later slice adds ino reconciliation).
    private internChild(state: FolderState, path: string, name: string, kind: ProjectNodeKind): ProjectContentNode
    {
        const existing = state.byPath.get(path)
        if (existing !== undefined) return state.children.get(existing)!
        const id = this.mintId()
        const node = new ProjectContentNode(id, path, name, kind)
        state.children.set(id, node)
        state.byPath.set(path, id)
        this.nodeById.set(id, node)
        if (kind === ProjectNodeKind.Folder) this.pathById.set(id, path)
        return node
    }

    private mintId(): ContentNodeId { return String(this.nextId++) as ContentNodeId }

    private static kindOf(name: string, isDirectory: boolean): ProjectNodeKind
    {
        if (isDirectory) return ProjectNodeKind.Folder
        const lower = name.toLowerCase()
        if (ProjectContentStore.DiagramExts.some((e) => lower.endsWith(e))) return ProjectNodeKind.Diagram
        if (lower.endsWith('.todl')) return ProjectNodeKind.Todl
        return ProjectNodeKind.File
    }
}
