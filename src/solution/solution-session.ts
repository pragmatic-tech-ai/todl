import { Observable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionMember } from './solution-member.js'
import { type SolutionSettingBag } from './solution-setting-bag.js'

// The live, in-memory solution: a name, the storage it is rooted at, its ordered
// member projects (opened all-at-once), its cross-project setting bags, and a
// dirty flag. Extends Observable so the shell binds Name/IsDirty and the
// explorer binds Members.
export class SolutionSession extends Observable {
    private _name: string
    private _dirty = false
    public readonly Storage: IStorage
    public readonly Members = new ObservableCollection<SolutionMember>()
    public readonly SettingBags = new ObservableCollection<SolutionSettingBag>()

    constructor(name: string, storage: IStorage) {
        super()
        this._name = name
        this.Storage = storage
    }

    public get Name(): string { return this._name }
    public set Name(v: string) {
        const old = this._name
        this._name = v
        this.RaisePropertyChanged('Name', old, v)
        this.markDirty()
    }

    public get IsDirty(): boolean { return this._dirty }
    public set IsDirty(v: boolean) {
        const old = this._dirty
        this._dirty = v
        this.RaisePropertyChanged('IsDirty', old, v)
    }

    public AddMember(path: string, type: string): SolutionMember {
        const member = new SolutionMember({ path, type })
        this.Members.Add(member)
        this.markDirty()
        return member
    }

    public RemoveMember(member: SolutionMember): void {
        this.Members.Remove(member)
        this.markDirty()
    }

    // Any member/setting mutation flips dirty; Save clears it.
    private markDirty(): void { if (!this._dirty) this.IsDirty = true }
}
