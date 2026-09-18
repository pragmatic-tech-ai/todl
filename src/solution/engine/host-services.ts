import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
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
// installed module contributes that type (an unresolved member, not a throw).
export interface IProjectFactoryRegistry {
    factoryFor(typeId: string): IProjectFactory | undefined
}

// (The former IDiscardConfirmer seam is gone: asking the user to discard unsaved
//  changes now flows through IPromptService.Ask(new ConfirmAsk(...)) — the generic
//  user-decision channel — resolved under SolutionManagerService.PromptServiceKey.)
