import { Observable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionMember } from './solution-member.js'
import { SolutionSettingBag } from './solution-setting-bag.js'
import { type SettingBagDefinition } from './setting-bag-definition.js'
import { type MemberStorageResolver, type ProjectFactoryResolver } from './project-factory.js'

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
    // Persisted setting values from the manifest, applied when bags bind (Task 13
    // enriches this; for now it is a pass-through store for load/collect).
    private loadedSettings: Record<string, Record<string, string | number | boolean>> = {}

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

    // Open ALL member projects: resolve each member's storage + factory, open it,
    // and stash the handle on the member. A member whose type has no registered
    // factory stays unresolved (Project === undefined) — no throw, so one missing
    // module doesn't break the whole solution.
    public async OpenMembers(storageFor: MemberStorageResolver, factoryFor: ProjectFactoryResolver): Promise<void> {
        for (const member of this.Members) {
            const factory = factoryFor(member.Ref.type)
            if (factory === undefined) { member.Project = undefined; continue }
            member.Project = await factory.openProject(storageFor(member.Ref.path))
        }
    }

    // Stash persisted setting values (from the manifest) to overlay when bags bind.
    public LoadSettings(values: Record<string, Record<string, string | number | boolean>>): void {
        this.loadedSettings = values ?? {}
    }

    // Build live setting bags from definitions, overlaying any loaded values; each
    // bag's write marks the session dirty. Idempotent per Id.
    public BindBags(defs: Iterable<SettingBagDefinition>): void {
        for (const def of defs) {
            if (this.SettingBags.ToArray().some((b) => b.Definition.Id === def.Id)) continue
            this.SettingBags.Add(new SolutionSettingBag(def, this.loadedSettings[def.Id], () => this.markDirty()))
        }
    }

    // The setting values to persist: touched live bags, plus any loaded values for
    // bags that never bound (a missing module's settings round-trip, not dropped).
    public CollectSettings(): Record<string, Record<string, string | number | boolean>> {
        const out: Record<string, Record<string, string | number | boolean>> = {}
        const bound = new Set<string>()
        for (const bag of this.SettingBags) {
            bound.add(bag.Definition.Id)
            if (bag.IsTouched) out[bag.Definition.Id] = bag.ToRecord()
        }
        for (const [id, vals] of Object.entries(this.loadedSettings)) {
            if (!bound.has(id) && !(id in out)) out[id] = vals
        }
        return out
    }

    // Any member/setting mutation flips dirty; Save clears it.
    private markDirty(): void { if (!this._dirty) this.IsDirty = true }
}
