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

// Prompts the user to discard unsaved changes before the active solution is
// replaced; resolves true to discard. Implemented app-side over the Mural
// DialogService, which keeps the manager itself UI-agnostic.
export interface IDiscardConfirmer {
    confirmDiscard(): Promise<boolean>
}
