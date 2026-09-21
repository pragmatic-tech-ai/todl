import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { type ProjectFileFormat } from '../core/project-factory.js'
import { ProducerProjectFactory } from '../core/producer-project-factory-base.js'
import { CLAUDE_DIR, CLAUDE_MD_FILENAME, type ScaffoldFile } from '../core/todl-project-factory.js'
import { ProjectNodeKind } from '../core/project.js'
import { META_MODEL_CLAUDE_ROOT, META_MODEL_GUIDE, META_MODEL_NEW_CONCEPT } from '../core/scaffold.generated.js'

// The 'meta-model' project type. Internally identical to a library — all producer logic
// lives in ProducerProjectFactory; this subclass declares only the user-facing identity
// (type, title, scaffold) and the presentation dictionary. A meta-model needs no bases of
// its own, but may reference other meta-models/libraries like any producer.
export class MetaModelProjectFactory extends ProducerProjectFactory
{
    public static readonly Key = new ServiceKey<MetaModelProjectFactory>('MetaModelProjectFactory')
    public static readonly ProjectType = 'meta-model'

    public readonly typeId = MetaModelProjectFactory.ProjectType
    public readonly title = 'Meta-model Project'
    public readonly description = 'Author and validate TODL meta-model definitions.'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: ProjectNodeKind.Todl, displayName: 'TODL Definition' },
    ]

    protected readonly presentationDict = 'MetaModelPresentation'
    protected readonly iconPrefix = 'mm:'

    constructor(provider: IServiceProvider) { super(provider) }

    // The meta-model's own scaffold (its CLAUDE.md + guide + /new-concept); the shared
    // TODL manual + rules are added by the base.
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [
            { path: CLAUDE_MD_FILENAME, content: META_MODEL_CLAUDE_ROOT },
            { path: `${CLAUDE_DIR}/meta-model-guide.md`, content: META_MODEL_GUIDE },
            { path: `${CLAUDE_DIR}/commands/new-concept.md`, content: META_MODEL_NEW_CONCEPT },
        ]
    }
}
