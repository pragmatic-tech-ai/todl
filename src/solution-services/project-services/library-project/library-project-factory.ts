import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { type ProjectFileFormat } from '../core/project-factory.js'
import { ProducerProjectFactory } from '../core/producer-project-factory-base.js'
import { CLAUDE_MD_FILENAME, type ScaffoldFile } from '../core/todl-project-factory.js'
import { ProjectNodeKind } from '../core/project.js'
import { LIBRARY_CLAUDE_ROOT } from '../core/scaffold.generated.js'

// The 'library' project type. Internally identical to a meta-model — all producer logic
// lives in ProducerProjectFactory; this subclass declares only the user-facing identity
// (type, title, scaffold) and the presentation dictionary. A library is authored against
// at least one meta-model (requiresMetaModel), but that is only a publish-time gate;
// resolution treats every base reference uniformly.
export class LibraryProjectFactory extends ProducerProjectFactory
{
    public static readonly Key = new ServiceKey<LibraryProjectFactory>('LibraryProjectFactory')
    public static readonly ProjectType = 'library'

    public readonly typeId = LibraryProjectFactory.ProjectType
    public readonly title = 'Library Project'
    public readonly description = 'Author a technology library (taxonomy) against a meta-model.'

    public override readonly requiresMetaModel = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: ProjectNodeKind.Todl, displayName: 'TODL Definition' },
    ]

    protected readonly presentationDict = 'LibraryPresentation'
    protected readonly iconPrefix = ''

    constructor(provider: IServiceProvider) { super(provider) }

    // The library's own scaffold (its CLAUDE.md); the shared TODL manual + rules are added
    // by the base.
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [{ path: CLAUDE_MD_FILENAME, content: LIBRARY_CLAUDE_ROOT }]
    }
}
