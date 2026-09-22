import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import {
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../core/project-factory.js'
import { type ProjectBaseModelBindings, type PublishedBaseModelReference } from '../core/base-binding.js'
import { ProjectNodeKind } from '../core/project.js'
import { TodlProjectFactory, CLAUDE_MD_FILENAME, type ScaffoldFile } from '../core/todl-project-factory.js'
import { ARCHITECTURE_CLAUDE_ROOT } from '../core/scaffold.generated.js'

// The 'architecture' project type — a module's contribution to the generic project
// explorer (declared via `.projectFactories:`, resolved through the factory
// registry). It is a TODL-authoring project: its `.todl` files are the instance-tier
// architecture model, validated live against the project's BOUND bases — a meta-model
// AND a set of libraries — by the shared base-aware validation (which reads the
// manifest's metaModel + libraries via resolveBases). Architecture composes bases
// (meta-models, libraries, and other architectures) and is packaged through the
// build-system pipeline (NpmPackageBuildSystem); it is not wired to the legacy factory
// publish path.
//
// All project-lifecycle plumbing (create/open/save, the tree walk, and the TODL agent
// scaffold) lives in TodlProjectFactory; this class declares only what differs: the
// .diagram + .todl formats, the bound-manifest shape, and its own CLAUDE.md scaffold
// contribution. The `.todl` / `.diagram` FILE formats are edited by their document
// factories (resolved by extension) — editors own files, this factory owns the project.
interface ArchitectureManifest extends ProjectManifestEnvelope
{
    id?: string                                             // publishable package id (slug of name)
    packageVersion?: string                                 // published version of this architecture package
    metaModels?: readonly PublishedBaseModelReference[]      // the meta-models this architecture conforms to
    libraries?: readonly PublishedBaseModelReference[]       // the technology libraries it draws on
    architectures?: readonly PublishedBaseModelReference[]   // other architectures this one composes
    diagrams?: { [path: string]: { viewpoints: string[] } }   // per-diagram viewpoint selection
}

export class ArchitectureProjectFactory extends TodlProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'
    private static readonly DefaultPackageVersion = '0.1.0'

    public readonly typeId = ArchitectureProjectFactory.ProjectType
    public readonly title = 'Architecture Project'
    public readonly description = ''

    public readonly requiresMetaModel = true
    public readonly offersLibraries = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: ProjectNodeKind.Diagram, displayName: 'Diagram' },
        { extension: '.todl', kind: ProjectNodeKind.Todl, displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    protected buildManifest(name: string, bindings?: ProjectBaseModelBindings): ProjectManifestEnvelope
    {
        const manifest: ArchitectureManifest = {
            type: ArchitectureProjectFactory.ProjectType, name, version: 1,
            id: ArchitectureProjectFactory.slugify(name),
            packageVersion: ArchitectureProjectFactory.DefaultPackageVersion,
            ...(bindings?.metaModels !== undefined && bindings.metaModels.length > 0
                ? { metaModels: bindings.metaModels } : {}),
            ...(bindings?.libraries !== undefined && bindings.libraries.length > 0
                ? { libraries: bindings.libraries } : {}),
            ...(bindings?.architectures !== undefined && bindings.architectures.length > 0
                ? { architectures: bindings.architectures } : {}),
        }
        return manifest
    }

    private static slugify(name: string): string
    {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'architecture'
    }

    // The architecture project's own scaffold (its CLAUDE.md); the shared TODL manual
    // + rules are added by the base.
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [{ path: CLAUDE_MD_FILENAME, content: ARCHITECTURE_CLAUDE_ROOT }]
    }
}
