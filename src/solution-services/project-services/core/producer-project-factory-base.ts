import { type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { checkAgainst } from '../../../compiler-services/api.js'
import { toJSON, type TodlDocument } from '../../../compiler-services/emit/json.js'
import { Severity } from '../../../compiler-services/diagnostics/diagnostic.js'
import {
    PROJECT_MANIFEST_FILENAME,
    type IVersionedProjectFactory,
    type ProjectManifestEnvelope,
} from './project-factory.js'
import { type IBaseProducingProjectFactory } from './producer-project-factory.js'
import { ManifestParser } from '../../package-manager/manifest.js'
import { TodlProjectFactory } from './todl-project-factory.js'
import { type ProjectBaseModelBindings, type PublishedBaseModelReference } from './base-binding.js'
import { TodlProjectSourceFiles } from './todl-sources.js'

// A producer project's persisted manifest. Meta-models and libraries share this exact
// shape — the two are the same internally; they differ only in the user-facing labels the
// concrete subclasses carry.
export interface ProducerManifest extends ProjectManifestEnvelope
{
    id: string
    packageVersion: string
    metaModels?: readonly PublishedBaseModelReference[]
    libraries?: readonly PublishedBaseModelReference[]
    description?: string
}

// The single producer implementation shared by the meta-model and library project types.
// It owns manifest, versioning, and compile — packaging (resolve bases -> compile own-only
// -> stamp -> scan resources -> bake presentation -> persist model.json + bundle.json +
// resources) now runs through the build-system pipeline (NpmPackageBuildSystem). A concrete
// subclass declares ONLY its user-facing identity: the project type, title/description,
// scaffold, and the presentation dictionary name + icon key prefix. Everything else is
// identical, because internally a meta-model and a library are the same thing.
export abstract class ProducerProjectFactory extends TodlProjectFactory
    implements IBaseProducingProjectFactory, IVersionedProjectFactory
{
    // The presentation dictionary name + icon-key prefix the subclass bakes under (the one
    // thing that legitimately differs between a meta-model and a library presentation).
    protected abstract readonly presentationDict: string
    protected abstract readonly iconPrefix: string

    // Whether this producer must be authored against at least one meta-model (a library
    // does; a meta-model does not). Only gates publish; resolution is uniform either way.
    public readonly requiresMetaModel: boolean = false

    protected buildManifest(name: string, bindings?: ProjectBaseModelBindings): ProjectManifestEnvelope
    {
        const manifest: ProducerManifest = {
            type: this.typeId, name, version: 1,
            id: ProducerProjectFactory.slugify(name), packageVersion: '0.1.0',
            ...(bindings?.metaModels !== undefined && bindings.metaModels.length > 0 ? { metaModels: bindings.metaModels } : {}),
            ...(bindings?.libraries !== undefined && bindings.libraries.length > 0 ? { libraries: bindings.libraries } : {}),
        }
        return manifest
    }

    public async getVersion(storage: IStorage): Promise<string>
    {
        return (await this.readManifest(storage)).packageVersion
    }

    public async setVersion(storage: IStorage, version: string): Promise<void>
    {
        const manifest = await this.readManifest(storage)
        manifest.packageVersion = version
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Compile the taxonomy sources (samples/ excluded) against the given bases. Bases are
    // already resolved by the caller (empty for a meta-model with no bindings).
    public async compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        _provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
    {
        const sources = await TodlProjectSourceFiles.CollectTaxonomy(storage)
        const { model, diagnostics } = checkAgainst(bases, sources)
        const problems = diagnostics.filter((d) => d.severity === Severity.Error).map((d) => d.message)
        return { doc: toJSON(model), problems }
    }

    // NOTE: the former publish() (validate -> compilePackage -> bake presentation ->
    // persist model.json + bundle.json + resource folders) is retired. Coverage moved to
    // the build pipeline: emit-bundle-action / bake-resources-action / publish-package-action
    // / solution-build tests.

    // Parse through ManifestParser so a legacy producer manifest (libVersion /
    // modelVersion, singular metaModel) is upgraded before getVersion reads
    // packageVersion off it.
    private async readManifest(storage: IStorage): Promise<ProducerManifest>
    {
        return ManifestParser.Parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProducerManifest
    }

    private static slugify(name: string): string
    {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'package'
    }
}
