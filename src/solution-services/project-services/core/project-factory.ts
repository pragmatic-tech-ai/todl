import { type IStorage, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { type Project } from './project.js'
import { type ProjectBaseModelBindings } from './base-binding.js'
import { type IProjectContentGenerator } from '../generators/project-content-generator.js'

// The contract a module's project factory implements — the behavior the generic
// project explorer delegates to. A module declares a project-factory definition
// whose Factory service token resolves to an IProjectFactory; the explorer routes
// create/open/save through it, staying ignorant of any concrete project. FILE
// editing (open/save/new a document) is a separate concern — an IDocumentFactory
// resolved by extension; editors own files, factories own projects.
//
// Persistence flows through an IStorage (rooted at the project, project-relative
// paths) rather than the raw file system, so a project's backend — local FS today,
// cloud/REST later — is transparent to the factory. The explorer builds the
// IStorage and hands it in.

// The manifest file at a project folder's root. Its `type` routes a folder to the
// factory that owns it; the rest of the manifest is factory-specific (each factory
// reads/writes its own extended shape). Only this envelope is generic. (JSON
// content, but the `.plexus` name alone identifies it — no `.json` tail.)
export const PROJECT_MANIFEST_FILENAME = 'project.plexus'

export interface ProjectManifestEnvelope
{
    type: string
    name?: string
    version?: number
    // The storage backend the project lives on (a StorageProviderRegistry id).
    // Absent ⇒ the default 'local' backend.
    storage?: string
}

// One file format a factory understands — surfaced in a "New file" affordance.
// `kind` is the ProjectNode kind a matching file gets ('diagram' / 'todl' for
// openable-in-app formats) — a routing token matched against a node's Kind, kept a
// plain string so hosts can declare formats with string literals.
export interface ProjectFileFormat
{
    extension: string           // leading dot, e.g. ".diagram"
    kind: string
    displayName: string
}

export interface IProjectFactory
{
    // Self-describing project-type metadata — the stable type id a manifest's
    // `type` field carries and the New-Project gallery's display strings. These
    // used to live in a mural `ProjectFactoryDefinition`; the factory now owns
    // them, so the registry can enumerate types without a parallel definition.
    readonly typeId: string
    readonly title: string
    readonly description: string

    readonly formats: readonly ProjectFileFormat[]

    // True when creating this project type needs a meta-model base chosen up front
    // (the New-Project dialog shows a meta-model picker). Absent ⇒ false.
    readonly requiresMetaModel?: boolean

    // True when this project type binds a set of libraries chosen up front (the
    // New-Project dialog shows a libraries multi-select). Absent ⇒ false.
    readonly offersLibraries?: boolean

    // Project lifecycle. createProject writes an initial manifest into a fresh
    // project storage — with the chosen base bindings, when the type declares any;
    // openProject reads the manifest + builds the file tree; saveProject persists
    // project-level state (the manifest). All operate on a rooted IStorage
    // (project-relative paths).
    createProject(storage: IStorage, name: string, bindings?: ProjectBaseModelBindings): Promise<Project>
    openProject(storage: IStorage): Promise<Project>
    saveProject(project: Project, storage: IStorage): Promise<void>
}

// The outcome of a publish — surfaced verbatim by the explorer as its status.
export interface PublishResult
{
    ok: boolean
    message: string
}

// Optional capability a factory MAY also implement: producing a shareable artifact
// from the project. The explorer feature-tests with isPublishable before offering
// its Publish command — the same pattern as ILocalFileAccess. `provider` is passed
// so publish can resolve a destination backend / services.
/**
 * @deprecated The factory publish path is obsolete. Package a project through the
 * build-system pipeline instead — NpmPackageBuildSystem via TodlProjectBuildManager,
 * which handles meta-model, library, and architecture projects uniformly. This
 * interface remains only for the legacy Plexus "Publish" command.
 */
export interface IPublishableProjectFactory
{
    publish(project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
}

// Type guard: does this factory support publishing?
export function isPublishable(factory: IProjectFactory): factory is IProjectFactory & IPublishableProjectFactory
{
    return typeof (factory as Partial<IPublishableProjectFactory>).publish === 'function'
}

// Optional capability a factory MAY also implement: (re)generating a presentation
// resource dictionary into the project from its compiled model. `colored` picks the
// icon mode (true → colorful IconDefinitions, false → monochrome geometry). The
// explorer feature-tests with canGeneratePresentation before offering its Generate
// Presentation submenu (Colorful / Monochrome) — same pattern as isPublishable.
export interface IPresentationProjectFactory
{
    regeneratePresentation(storage: IStorage, colored: boolean): Promise<void>
}

// Type guard: can this factory (re)generate a presentation?
export function canGeneratePresentation(
    factory: IProjectFactory,
): factory is IProjectFactory & IPresentationProjectFactory
{
    return typeof (factory as Partial<IPresentationProjectFactory>).regeneratePresentation === 'function'
}

// Optional capability a factory MAY also implement: declaring the content generators
// for its project type. Composition registers these into the ProjectGeneratorRegistry
// (Task 8) — the explorer does not call this directly, unlike isPublishable /
// canGeneratePresentation.
export interface IGeneratingProjectFactory
{
    generators(): readonly IProjectContentGenerator[]
}

// Type guard: does this factory declare its own content generators?
export function providesGenerators(
    factory: IProjectFactory,
): factory is IProjectFactory & IGeneratingProjectFactory
{
    return typeof (factory as Partial<IGeneratingProjectFactory>).generators === 'function'
}

// Optional capability a producer factory (meta-model, library) implements: read and
// update the manifest's published version. The explorer's Bump Version command
// feature-tests with isVersioned before offering it — same pattern as isPublishable.
// Each producer knows its own manifest field (modelVersion / libVersion); this seam
// hides that from the caller.
export interface IVersionedProjectFactory
{
    getVersion(storage: IStorage): Promise<string>
    setVersion(storage: IStorage, version: string): Promise<void>
}

// Type guard: does this factory expose a bumpable version?
export function isVersioned(
    factory: IProjectFactory,
): factory is IProjectFactory & IVersionedProjectFactory
{
    const f = factory as Partial<IVersionedProjectFactory>
    return typeof f.getVersion === 'function' && typeof f.setVersion === 'function'
}

// The producer kinds — the two user-facing producer project types. Meta-models and
// libraries are identical internally (both are ProducerProjectFactory); this enum is the
// user-facing distinction hosts use to present and manage them separately. Values match
// the corresponding factory `ProjectType` strings.
export enum ProducerKind
{
    MetaModel = 'meta-model',
    Library = 'library',
}
