import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectContentStore } from '../../project-services/content/project-content-store.js'
import { ContentAdded, ContentRemoved, ContentUpdated, type ContentChange } from '../../project-services/content/content-change.js'
import { type ContentNodeId } from '../../project-services/content/content-node.js'
import { ProjectNodeKind } from '../../project-services/core/project.js'

// Watches one solution member's on-disk content tree for `.todl` file add/remove
// and invokes `onTodlStructureChanged` so the language service can invalidate that
// member's warm bases. `ProjectContentStore.ObserveChildren` observes a single
// folder level, so this recursively observes every folder — a `.todl` added or
// removed anywhere under the member is caught, not just at the root. Open-buffer
// edits are handled elsewhere (DidChange); this is the on-disk add/remove path,
// the lifecycle seam Wave 1 deferred. (#16)
export class MemberContentWatcher
{
    private readonly store: ProjectContentStore
    private readonly folderSubs = new Map<ContentNodeId, () => void>()
    private readonly nodeKind = new Map<ContentNodeId, ProjectNodeKind>()
    // Suppresses the change callback during the initial recursive enumeration, so the
    // existing files a member already has on disk are the baseline, not a flood of
    // "changed" signals. Flipped false once Start() has drained the first sweep.
    private warming = true
    private disposed = false

    constructor(storage: IStorage, private readonly onTodlStructureChanged: () => void, options?: { settleMs?: number })
    {
        this.store = new ProjectContentStore(storage, options)
    }

    // Observe the whole tree once (recursing into every folder) and establish the
    // baseline, then begin reporting live add/remove. Awaitable so the owner can
    // serialize it onto its maintenance tail for deterministic tests.
    public async Start(): Promise<void>
    {
        this.observeFolder(this.store.Root.Id)
        // Each observed folder loads async and may reveal subfolders to observe; drain
        // until the observed-folder set stops growing and no load is in flight.
        let previous = -1
        while (!this.disposed && this.folderSubs.size !== previous)
        {
            previous = this.folderSubs.size
            await this.store.WhenIdle()
        }
        this.warming = false
    }

    private observeFolder(folder: ContentNodeId): void
    {
        if (this.disposed || this.folderSubs.has(folder)) return
        this.folderSubs.set(folder, this.store.ObserveChildren(folder, (c) => this.onChange(c)))
    }

    private onChange(change: ContentChange): void
    {
        if (this.disposed) return
        if (change instanceof ContentAdded)
        {
            this.nodeKind.set(change.Node.Id, change.Node.Kind)
            if (change.Node.Kind === ProjectNodeKind.Folder) this.observeFolder(change.Node.Id)
            else if (change.Node.Kind === ProjectNodeKind.Todl) this.fire()
        }
        else if (change instanceof ContentRemoved)
        {
            const kind = this.nodeKind.get(change.Id)
            this.nodeKind.delete(change.Id)
            const off = this.folderSubs.get(change.Id)
            if (off !== undefined) { off(); this.folderSubs.delete(change.Id) }
            if (kind === ProjectNodeKind.Todl) this.fire()
        }
        else if (change instanceof ContentUpdated)
        {
            // A rename that produces or removes a `.todl` changes the member's source set.
            const was = this.nodeKind.get(change.Node.Id)
            this.nodeKind.set(change.Node.Id, change.Node.Kind)
            if (change.Node.Kind === ProjectNodeKind.Todl || was === ProjectNodeKind.Todl) this.fire()
        }
    }

    private fire(): void
    {
        if (!this.warming) this.onTodlStructureChanged()
    }

    public dispose(): void
    {
        this.disposed = true
        for (const off of this.folderSubs.values()) off()
        this.folderSubs.clear()
        this.nodeKind.clear()
        this.store.dispose()
    }
}
