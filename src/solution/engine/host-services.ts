import { ServiceKey, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from './project-factory.js'

// The host services the SolutionManagerService resolves from the container (by
// ServiceKey). These are real interfaces with real implementing classes — the
// app supplies concretes at the composition root, a test supplies fakes. They
// replace the former `SolutionSeams` lambda bag so the manager depends on
// services, not a bag of closures.

// Builds a rooted IStorage for a folder using the registry's default backend.
// The manager roots the solution and each member through this; which backend is
// "default" (local fs, a remote container, …) stays the host's concern.
export interface IStorageProviderRegistry {
    CreateStorage(location: string): IStorage
}

// Resolves a project type id to the factory that opens it, or undefined when no
// installed module contributes that type (an unresolved member, not a throw); and
// enumerates every installed factory for a New-Project gallery (each factory is
// self-describing — typeId/title/description live on it).
export interface IProjectFactoryRegistry {
    factoryFor(typeId: string): IProjectFactory | undefined
    All(): readonly IProjectFactory[]
}

// The container key the registry registers under. Exported as a standalone const
// (not only as SolutionManagerService.ProjectFactoryRegistryKey) so a basic
// module's `.services:` markup can name it directly in the `Impl -> Token` form —
// the compiler's `-> Token` accepts a bare imported symbol, not a static member.
// SolutionManagerService aliases its static to this same instance.
export const ProjectFactoryRegistryKey =
    new ServiceKey<IProjectFactoryRegistry>('SolutionProjectFactoryRegistry')

// (The former IDiscardConfirmer seam is gone: asking the user to discard unsaved
//  changes now flows through IPromptService.Ask(new ConfirmAsk(...)) — the generic
//  user-decision channel — resolved under SolutionManagerService.PromptServiceKey.)
