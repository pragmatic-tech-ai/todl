import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The canonical project-factory contract lives in the projects module (the home of
// the whole project infrastructure) — re-exported here so the solution engine's
// consumers keep importing it from one place. A concrete factory (TodlProjectFactory
// subclass) satisfies it; the engine only ever calls openProject to resolve members.
export { type IProjectFactory } from '../projects/project-factory.js'

// Resolve a member's relative path to a rooted IStorage (host-supplied).
export type MemberStorageResolver = (relpath: string) => IStorage

// Resolve a project type id to its factory, or undefined when unknown/uninstalled.
export type ProjectFactoryResolver = (typeId: string) => import('../projects/project-factory.js').IProjectFactory | undefined
