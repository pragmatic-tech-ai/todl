import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Consumer-side project factory contract (minimal): opens / creates / saves a
// project rooted at an IStorage. A host registers concrete factories against
// project type ids via Mural's ProjectFactoryRegistry; the solution machinery
// only needs these three verbs.
export interface IProjectFactory {
    openProject(storage: IStorage): Promise<unknown>
    createProject(storage: IStorage, name: string): Promise<unknown>
    saveProject(project: unknown, storage: IStorage): Promise<void>
}

// Resolve a member's relative path to a rooted IStorage (host-supplied).
export type MemberStorageResolver = (relpath: string) => IStorage

// Resolve a project type id to its factory, or undefined when unknown/uninstalled.
export type ProjectFactoryResolver = (typeId: string) => IProjectFactory | undefined
