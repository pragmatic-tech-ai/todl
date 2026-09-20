import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from '../project-factory.js'
import { type ProjectFileFormat } from '../../../project-services/core/project-factory.js'
import { Project, ProjectNode, ProjectNodeKind } from '../../../project-services/core/project.js'

// A test double for IProjectFactory: records how it was used and returns minimal
// real Project handles (an empty root node) so it satisfies the canonical contract.
export class FakeProjectFactory implements IProjectFactory
{
    public readonly typeId = 'fake'
    public readonly title = 'Fake Project'
    public readonly description = ''
    public readonly formats: readonly ProjectFileFormat[] = []
    public openCount = 0
    public saveCount = 0
    public lastOpenedRoot: string | undefined

    async openProject(storage: IStorage): Promise<Project>
    {
        this.openCount++
        this.lastOpenedRoot = storage.Root
        return this.emptyProject(storage.Root)
    }

    async createProject(storage: IStorage, name: string): Promise<Project>
    {
        return new Project('fake', name, storage.Root, new ProjectNode(name, '', ProjectNodeKind.Folder))
    }

    async saveProject(_project: Project, _storage: IStorage): Promise<void>
    {
        this.saveCount++
    }

    private emptyProject(root: string): Project
    {
        return new Project('fake', root, root, new ProjectNode(root, '', ProjectNodeKind.Folder))
    }
}
