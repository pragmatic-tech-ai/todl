import { type ProjectContentNode, type ContentNodeId } from './content-node.js'

// The store's native, mural-independent change delta. A UI-layer provider
// (in plexus-core) maps these onto the mural hierarchy's child deltas.
export abstract class ContentChange {}

export class ContentAdded extends ContentChange
{
    constructor(public readonly Node: ProjectContentNode) { super() }
}

export class ContentUpdated extends ContentChange   // rename/refresh: new Path/Name, SAME Id
{
    constructor(public readonly Node: ProjectContentNode) { super() }
}

export class ContentRemoved extends ContentChange
{
    constructor(public readonly Id: ContentNodeId) { super() }
}
