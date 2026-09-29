import { type IStorage, compareStorageEntries } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectNodeKind } from '../core/project.js'
import { ProjectContentNode, type ContentNodeId } from './content-node.js'
import { ContentAdded, type ContentChange } from './content-change.js'

interface FolderState
{
    loaded: boolean
    loading?: Promise<void>
    readonly children: Map<ContentNodeId, ProjectContentNode>   // insertion = child set
    readonly byPath: Map<string, ContentNodeId>
    readonly byIno: Map<string, ContentNodeId>                  // 'dev:ino' -> id (nonzero ino only)
    readonly sinks: Set<(c: ContentChange) => void>
    watchOff?: () => void
}

// A reactive, lazy per-project content store over an IStorage: enumerates a folder
// one level on first subscribe (realize = subscribe), mints stable ids, and hands
// children out as ContentChange deltas. Watching + reconciliation is layered on in
// a later slice; this core is the keyed identity + lazy load.
export class ProjectContentStore
{
    private static readonly RootPath = ''
    private static readonly DiagramExts = ['.archdiagram', '.diagram']
    private nextId = 1
    private readonly folders = new Map<ContentNodeId, FolderState>()   // folder id -> its state
    private readonly nodeById = new Map<ContentNodeId, ProjectContentNode>()
    private readonly pathById = new Map<ContentNodeId, string>()       // folder id -> its project path
    public readonly Root: ProjectContentNode

    constructor(private readonly storage: IStorage)
    {
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
            s = { loaded: false, children: new Map(), byPath: new Map(), byIno: new Map(), sinks: new Set() }
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
            for (const sink of [...state.sinks]) sink(new ContentAdded(node))
        }
        state.loaded = true
        // A later slice starts the watcher here.
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
