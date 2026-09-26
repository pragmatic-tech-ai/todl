import { Observable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type SolutionMemberRef } from './solution-member-ref.js'

// One member project of a solution: its manifest reference (path + type), the
// opened project handle (set when the solution opens all members), the rooted
// storage that project was opened from (stashed by Solution.OpenMembers so a
// later live-compile can reuse it instead of re-resolving it), and a display
// title. Extends Observable so the explorer binds Title/Project.
export class SolutionMember extends Observable
{
    public readonly Ref: SolutionMemberRef
    private _project: unknown | undefined
    private _storage: IStorage | undefined
    private _title: string

    constructor(ref: SolutionMemberRef)
    {
        super()
        this.Ref = ref
        this._title = ref.path
    }

    public get Project(): unknown | undefined { return this._project }
    public set Project(v: unknown | undefined)
    {
        const old = this._project
        this._project = v
        this.RaisePropertyChanged('Project', old, v)
    }

    // The rooted IStorage the member's Project was opened from — plain
    // infrastructure state, not bound UI, so no RaisePropertyChanged.
    public get Storage(): IStorage | undefined { return this._storage }
    public set Storage(v: IStorage | undefined) { this._storage = v }

    public get Title(): string { return this._title }
    public set Title(v: string)
    {
        const old = this._title
        this._title = v
        this.RaisePropertyChanged('Title', old, v)
    }

    // A member with a resolved project handle; false ⇒ unresolved (broken ref —
    // a type with no registered factory).
    public get IsResolved(): boolean { return this._project !== undefined }
}
