import {
    type IStorage, compareStorageEntries,
    isStatStorage, isWatchableStorage, FileChangeKind, type FileChange,
} from '@pragmatic-tech-ai/todl-runtime'
import { ProjectNodeKind } from '../core/project.js'
import { ProjectContentNode, type ContentNodeId } from './content-node.js'
import { ContentAdded, ContentRemoved, ContentUpdated, type ContentChange } from './content-change.js'

interface FolderState
{
    loaded: boolean
    loading?: Promise<void>
    readonly children: Map<ContentNodeId, ProjectContentNode>   // insertion = child set
    readonly byPath: Map<string, ContentNodeId>
    readonly byIno: Map<string, ContentNodeId>                  // 'dev:ino' -> id (nonzero ino only)
    readonly sinks: Set<(c: ContentChange) => void>
    watchOff?: (() => void) | undefined
    // Buffered removals (keyed by path) awaiting rename correlation within the settle window.
    readonly pendingRemovals: Map<string, { id: ContentNodeId; inoKey: string; isDir: boolean }>
    timer?: ReturnType<typeof setTimeout> | undefined
}

// A reactive, lazy per-project content store over an IStorage: enumerates a folder
// one level on first subscribe (realize = subscribe), mints stable ids, and hands
// children out as ContentChange deltas. Watching + reconciliation is layered on in
// a later slice; this core is the keyed identity + lazy load.
export class ProjectContentStore
{
    private static readonly RootPath = ''
    private static readonly DiagramExts = ['.archdiagram', '.diagram']
    private static readonly DefaultSettleMs = 75
    private readonly settleMs: number
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
        if (!state.loaded) { state.loading = this.load(folder, state) }
        else { for (const node of state.children.values()) sink(new ContentAdded(node)) }
        return () =>
        {
            state.sinks.delete(sink)
            if (state.sinks.size === 0 && state.watchOff !== undefined) { state.watchOff(); state.watchOff = undefined }
        }
    }

    public dispose(): void
    {
        for (const s of this.folders.values()) { s.watchOff?.(); s.watchOff = undefined }
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

    private stateFor(folder: ContentNodeId): FolderState
    {
        let s = this.folders.get(folder)
        if (s === undefined)
        {
            s = { loaded: false, children: new Map(), byPath: new Map(), byIno: new Map(), sinks: new Set(), pendingRemovals: new Map() }
            this.folders.set(folder, s)
        }
        return s
    }

    private async load(folder: ContentNodeId, state: FolderState): Promise<void>
    {
        const dirPath = this.pathById.get(folder) ?? ProjectContentStore.RootPath
        const entries = [...await this.storage.List(dirPath)].sort(compareStorageEntries)
        for (const entry of entries)
        {
            const childPath = dirPath === '' ? entry.Name : `${dirPath}/${entry.Name}`
            const node = this.internChild(state, childPath, entry.Name, ProjectContentStore.kindOf(entry.Name, entry.IsDirectory))
            const inoKey = await this.inoKeyFor(childPath)
            if (inoKey !== '') state.byIno.set(inoKey, node.Id)
            for (const sink of [...state.sinks]) sink(new ContentAdded(node))
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
            const inoKey = await this.inoKeyFor(c.Path)
            const match = this.matchPendingRename(state, inoKey, c.IsDirectory)
            if (match !== undefined)                       // rename: reuse id, update in place
            {
                state.pendingRemovals.delete(match.path)
                const node = state.children.get(match.id)!
                state.byPath.delete(node.Path)
                node.Name = ProjectContentStore.baseName(c.Path)
                node.Path = c.Path
                state.byPath.set(c.Path, match.id)
                if (inoKey !== '') state.byIno.set(inoKey, match.id)
                for (const sink of [...state.sinks]) sink(new ContentUpdated(node))
                return
            }
            const node = this.internChild(state, c.Path, ProjectContentStore.baseName(c.Path), ProjectContentStore.kindOf(ProjectContentStore.baseName(c.Path), c.IsDirectory))
            if (inoKey !== '') state.byIno.set(inoKey, node.Id)
            for (const sink of [...state.sinks]) sink(new ContentAdded(node))
            return
        }
        // Changed: content-only; the P1 tree surfaces Name/Kind only → no delta.
    }

    private matchPendingRename(state: FolderState, inoKey: string, isDir: boolean): { path: string; id: ContentNodeId } | undefined
    {
        if (inoKey === '') return undefined                // no inode → cannot correlate; treat as add
        for (const [path, p] of state.pendingRemovals)
        {
            if (p.inoKey === inoKey && p.isDir === isDir) return { path, id: p.id }
        }
        return undefined
    }

    private scheduleFlush(state: FolderState): void
    {
        if (state.timer !== undefined) return
        const flush = (): void =>
        {
            state.timer = undefined
            for (const [path, p] of [...state.pendingRemovals])
            {
                state.pendingRemovals.delete(path)
                state.children.delete(p.id)
                state.byPath.delete(path)
                this.nodeById.delete(p.id)
                if (p.inoKey !== '') state.byIno.delete(p.inoKey)
                // If the removed node was an expanded folder, dispose its watcher and drop
                // its state so no watcher leaks and no late delta reaches its subscribers.
                const childState = this.folders.get(p.id)
                if (childState !== undefined) { childState.watchOff?.(); this.folders.delete(p.id) }
                this.pathById.delete(p.id)
                for (const sink of [...state.sinks]) sink(new ContentRemoved(p.id))
            }
        }
        state.timer = setTimeout(flush, this.settleMs)
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
