import {
    type IHierarchyProvider, HierarchyItemId, type HierarchyChange,
    ChildAdded, ChildUpdated, ChildRemoved,
    type HierarchyNode, HierarchyPropertyId, NodeSeverity, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type ProjectContentStore } from './project-content-store.js'
import { type ProjectContentNode, type ContentNodeId } from './content-node.js'
import { ContentAdded, ContentUpdated, ContentRemoved, type ContentChange } from './content-change.js'
import { ContentNodeKey } from './content-node-key.js'
import { ProjectNodeKind } from '../core/project.js'

// Adapts the TODL-native ProjectContentStore (ContentChange feed, store ids) to the
// mural hierarchy contract: mints one HierarchyItemId per store node and reuses it, so
// ChildAdded/ChildUpdated/ChildRemoved all carry a ===-stable id. Thin — identity and
// enumeration live in the store; this maps deltas and answers node queries.
export class ProjectContentProvider implements IHierarchyProvider
{
    private static readonly Id = 'todl.project-content'
    public readonly ProviderId = ProjectContentProvider.Id
    private readonly idByContent = new Map<ContentNodeId, HierarchyItemId>()
    private readonly contentById = new Map<HierarchyItemId, ContentNodeId>()
    private readonly pathByItem = new Map<HierarchyItemId, string>()
    private readonly itemByPath = new Map<string, HierarchyItemId>()

    constructor(private readonly store: ProjectContentStore)
    {
        this.bind(store.Root)   // seed the root correspondence so ParseCanonicalName('') works
    }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        const contentId = this.contentById.get(node) ?? this.store.Root.Id
        return this.store.ObserveChildren(contentId, (c: ContentChange) =>
        {
            if (c instanceof ContentAdded)        sink(new ChildAdded(this.idFor(c.Node), this.hierarchyNode(c.Node)))
            else if (c instanceof ContentUpdated) sink(new ChildUpdated(this.idFor(c.Node), this.hierarchyNode(c.Node)))
            else if (c instanceof ContentRemoved) sink(new ChildRemoved(this.release(c.Id)))
        })
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        const node = this.nodeFor(id)
        if (node === undefined) return undefined
        switch (prop)
        {
            case HierarchyPropertyId.Caption:       return node.Name
            case HierarchyPropertyId.IconKey:       return ContentNodeKey.For(node.Kind)
            case HierarchyPropertyId.IsExpandable:  return node.Kind === ProjectNodeKind.Folder
            case HierarchyPropertyId.CanonicalName: return node.Path
            case HierarchyPropertyId.ExtObject:     return node
            case HierarchyPropertyId.Severity:      return NodeSeverity.Ok
            default:                                return undefined
        }
    }

    public GetCanonicalName(id: HierarchyItemId): string
    {
        return this.pathByItem.get(id) ?? ''
    }

    public ParseCanonicalName(name: string): HierarchyItemId
    {
        return this.itemByPath.get(name) ?? HierarchyItemId.Nil
    }

    public CanAccept(_target: HierarchyItemId, _drop: DropData): boolean
    {
        return false   // real drop rules are P3
    }

    private hierarchyNode(node: ProjectContentNode): HierarchyNode
    {
        return { Key: ContentNodeKey.For(node.Kind), Caption: node.Name, IconKey: ContentNodeKey.For(node.Kind), ExtObject: node, Severity: NodeSeverity.Ok }
    }

    private idFor(node: ProjectContentNode): HierarchyItemId
    {
        const hit = this.idByContent.get(node.Id)
        if (hit !== undefined)
        {
            const oldPath = this.pathByItem.get(hit)
            if (oldPath !== undefined && oldPath !== node.Path) this.itemByPath.delete(oldPath)   // rename: drop stale key
            this.pathByItem.set(hit, node.Path)
            this.itemByPath.set(node.Path, hit)
            return hit
        }
        return this.bind(node)
    }

    // Resolve a removed content node's id and forget it, so the maps do not grow
    // unbounded and ParseCanonicalName of its path returns Nil afterwards.
    private release(cid: ContentNodeId): HierarchyItemId
    {
        const id = this.idByContent.get(cid)
        if (id === undefined) return HierarchyItemId.Nil
        this.idByContent.delete(cid)
        this.contentById.delete(id)
        const path = this.pathByItem.get(id)
        if (path !== undefined) this.itemByPath.delete(path)
        this.pathByItem.delete(id)
        return id
    }

    private bind(node: ProjectContentNode): HierarchyItemId
    {
        const id = HierarchyItemId.Mint()
        this.idByContent.set(node.Id, id)
        this.contentById.set(id, node.Id)
        this.pathByItem.set(id, node.Path)
        this.itemByPath.set(node.Path, id)
        return id
    }

    private nodeFor(id: HierarchyItemId): ProjectContentNode | undefined
    {
        const cid = this.contentById.get(id)
        return cid === undefined ? undefined : this.store.NodeById(cid)
    }
}
