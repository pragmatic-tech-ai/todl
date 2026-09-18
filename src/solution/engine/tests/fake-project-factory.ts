import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from '../project-factory.js'

// A test double for IProjectFactory: records how it was used and returns opaque
// project handles.
export class FakeProjectFactory implements IProjectFactory {
    public openCount = 0
    public saveCount = 0
    public lastOpenedRoot: string | undefined

    async openProject(storage: IStorage): Promise<unknown> {
        this.openCount++
        this.lastOpenedRoot = storage.Root
        return { kind: 'fake' }
    }

    async createProject(_storage: IStorage, name: string): Promise<unknown> {
        return { kind: 'fake', name }
    }

    async saveProject(_project: unknown, _storage: IStorage): Promise<void> {
        this.saveCount++
    }
}
