import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { type ProjectNodeKind } from '../core/project.js'

export type ContentNodeId = string & { readonly __brand: 'ContentNodeId' }

// One file/folder in a project's content tree. Store-owned identity (Id is stable
// across renames); Path/Name are settable so a rename updates in place (INPC), the
// node instance preserved so a bound row keeps selection/expansion.
export class ProjectContentNode extends Observable
{
    private static readonly NameChanged = 'Name'
    private static readonly PathChanged = 'Path'
    public readonly Id: ContentNodeId
    public readonly Kind: ProjectNodeKind
    private _path: string
    private _name: string

    constructor(id: ContentNodeId, path: string, name: string, kind: ProjectNodeKind)
    {
        super()
        this.Id = id
        this._path = path
        this._name = name
        this.Kind = kind
    }

    public get Name(): string { return this._name }
    public set Name(v: string)
    {
        const old = this._name
        if (old === v) return
        this._name = v
        this.RaisePropertyChanged(ProjectContentNode.NameChanged, old, v)
    }

    public get Path(): string { return this._path }
    public set Path(v: string)
    {
        const old = this._path
        if (old === v) return
        this._path = v
        this.RaisePropertyChanged(ProjectContentNode.PathChanged, old, v)
    }
}
