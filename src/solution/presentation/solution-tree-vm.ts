import { Observable, type IStorage, compareStorageEntries } from '@pragmatic-tech-ai/todl-runtime'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { type Solution } from '../engine/solution.js'
import { type SolutionMember } from '../engine/solution-member.js'

// Resolve a member to the IStorage its project is rooted at (host-supplied).
export type MemberStorageFor = (member: SolutionMember) => IStorage

// A file/folder node in the Solution Explorer. A directory lazily lists its
// children on first expand (via IStorage.List, ordered folders-first); a file is
// a leaf (Children === undefined).
export class SolutionNodeVM extends Observable {
    public readonly Title: string
    public readonly IsDirectory: boolean
    public readonly Children: ObservableCollection<SolutionNodeVM> | undefined
    private readonly storage: IStorage
    private readonly path: string
    private loaded = false

    constructor(storage: IStorage, path: string, title: string, isDirectory: boolean) {
        super()
        this.storage = storage
        this.path = path
        this.Title = title
        this.IsDirectory = isDirectory
        this.Children = isDirectory ? new ObservableCollection<SolutionNodeVM>() : undefined
    }

    // One-shot lazy load of this directory's children.
    public async OnExpand(): Promise<void> {
        if (!this.IsDirectory || this.loaded) return
        this.loaded = true
        await SolutionNodeVM.populate(this.storage, this.path, this.Children!)
    }

    // List `dir` in `storage` (folders-first) and append a child node per entry.
    static async populate(storage: IStorage, dir: string, into: ObservableCollection<SolutionNodeVM>): Promise<void> {
        const entries = [...await storage.List(dir)].sort(compareStorageEntries)
        for (const e of entries) {
            const childPath = dir === '' ? e.Name : `${dir}/${e.Name}`
            into.Add(new SolutionNodeVM(storage, childPath, e.Name, e.IsDirectory))
        }
    }
}

// A member-project root row in the Solution Explorer. Resolved members expand to
// their folder structure; an unresolved member (no registered factory) shows as
// a leaf with IsResolved === false and never expands.
export class SolutionMemberNodeVM extends Observable {
    public readonly Member: SolutionMember
    public readonly Children: ObservableCollection<SolutionNodeVM> | undefined
    private readonly storage: IStorage | undefined
    private loaded = false

    constructor(member: SolutionMember, storage: IStorage | undefined) {
        super()
        this.Member = member
        this.storage = member.IsResolved ? storage : undefined
        this.Children = this.storage !== undefined ? new ObservableCollection<SolutionNodeVM>() : undefined
    }

    public get Title(): string { return this.Member.Title }
    public get IsResolved(): boolean { return this.Member.IsResolved }

    public async OnExpand(): Promise<void> {
        if (this.storage === undefined || this.loaded) return
        this.loaded = true
        await SolutionNodeVM.populate(this.storage, '', this.Children!)
    }
}

// The Solution Explorer root: one member row per session member.
export class SolutionTreeVM extends Observable {
    public readonly Roots = new ObservableCollection<SolutionMemberNodeVM>()

    constructor(session: Solution, storageFor: MemberStorageFor) {
        super()
        for (const member of session.Members) {
            const storage = member.IsResolved ? storageFor(member) : undefined
            this.Roots.Add(new SolutionMemberNodeVM(member, storage))
        }
    }
}
