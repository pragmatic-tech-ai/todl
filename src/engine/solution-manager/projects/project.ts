import { Observable, ObservableCollection } from '@pragmatic-tech-ai/todl-runtime'

// A project and its file tree — the generic, headless model a project factory
// populates. These are the CORE data types that live in todl (the full solution
// infrastructure home); the UI-facing wrapper (per-node commands, rename-editor
// state, export/import affordances) is a plexus-side concern layered on top.
// Both extend Observable so a presentation tree binds Name/Path per item and
// re-projects on Children changes.

// What a tree node represents. 'diagram' and 'todl' are files the active factory
// opens in-app (each is a factory format kind — the explorer routes any node
// whose kind matches a declared format to openFile); 'file' is any other
// attachment (opened via the OS); 'folder' groups.
export enum ProjectNodeKind
{
    Folder = 'folder',
    Diagram = 'diagram',
    Todl = 'todl',
    File = 'file',
}

export class ProjectNode extends Observable
{
    private _name: string
    private _path: string
    public readonly Kind: ProjectNodeKind
    public readonly Children = new ObservableCollection<ProjectNode>()

    constructor(name: string, path: string, kind: ProjectNodeKind)
    {
        super()
        this._name = name
        this._path = path
        this.Kind = kind
    }

    public get Name(): string { return this._name }
    // Settable so an in-place rename updates the node without rebuilding the tree
    // (the bound row re-reads Name; the node object is preserved, keeping its
    // container's expansion/selection). Path moves in lock-step, set by the caller.
    public set Name(v: string)
    {
        const old = this._name
        if (old === v) return
        this._name = v
        this.RaisePropertyChanged('Name', old, v)
    }

    public get Path(): string { return this._path }
    public set Path(v: string)
    {
        const old = this._path
        if (old === v) return
        this._path = v
        this.RaisePropertyChanged('Path', old, v)
    }
}

export class Project extends Observable
{
    public readonly Type: string
    public readonly Name: string
    public readonly RootPath: string
    public readonly Root: ProjectNode

    constructor(type: string, name: string, rootPath: string, root: ProjectNode)
    {
        super()
        this.Type = type
        this.Name = name
        this.RootPath = rootPath
        this.Root = root
    }
}
