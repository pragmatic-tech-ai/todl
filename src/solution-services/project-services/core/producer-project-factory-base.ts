import { type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { checkAgainst } from '../../../compiler-services/api.js'
import { toJSON, type TodlDocument } from '../../../compiler-services/emit/json.js'
import { Severity } from '../../../compiler-services/diagnostics/diagnostic.js'
import { compilePackage, PackageKind, type PackageRef } from '../../../publish/publish.js'
import { BlobPackageStore } from '../../../publish/stores.js'
import { projectAnnotations } from '../../../publish/reflect.js'
import {
    PROJECT_MANIFEST_FILENAME,
    type IPresentationProjectFactory,
    type IPublishableProjectFactory,
    type IVersionedProjectFactory,
    type ProjectManifestEnvelope,
    type PublishResult,
} from './project-factory.js'
import { type IBaseProducingProjectFactory } from './producer-project-factory.js'
import { TodlProjectFactory } from './todl-project-factory.js'
import { type Project } from './project.js'
import { type ProjectBaseModelBindings, type PublishedBaseModelReference } from './base-binding.js'
import { TodlProjectSourceFiles } from './todl-sources.js'
import { StoragePackageSink } from './storage-package-sink.js'
import { PresentationResourceEmitter } from './presentation-model.js'
import { PresentationBakerKey } from './presentation-baker.js'
import { RecursiveProjectReferencesResolver } from './base-resolver.js'
import { PackageStoreKey } from '../../build-services/package-store.js'
import { type PackageBundle, type PublishedClass, ProducerResources } from './package-bundle.js'

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
// It owns the whole lifecycle — manifest, versioning, compile, and the publish pipeline
// (resolve bases -> compile own-only -> stamp -> scan resources -> bake presentation ->
// persist model.json + bundle.json + resources). A concrete subclass declares ONLY its
// user-facing identity: the project type, title/description, scaffold, and the presentation
// dictionary name + icon key prefix. Everything else is identical, because internally a
// meta-model and a library are the same thing.
export abstract class ProducerProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IPresentationProjectFactory, IBaseProducingProjectFactory, IVersionedProjectFactory
{
    private static readonly PRESENTATION_FILE = 'presentation.generated.mu'
    private static readonly PACKAGE_NODE = 'package'
    private static readonly BundleFileName = 'bundle.json'
    private static readonly ResourceFolders = ['visuals', 'assets', 'docs', 'samples', 'thumbnails', 'resources', 'wiki']

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

    // Compile the taxonomy sources (samples/ excluded) against the given bases, exactly as
    // publish does. Bases are already resolved by the caller (empty for a meta-model with
    // no bindings).
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

    // Validate every taxonomy `.todl` against the resolved bases; if clean, emit model.json
    // + bundle.json + sources, bake presentation, and copy the resource folders into the
    // shared package store under `<id>/<packageVersion>/`.
    public async publish(_project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
    {
        const manifest = await this.readManifest(storage)
        const metaModels = manifest.metaModels ?? []
        const libraries = manifest.libraries ?? []
        if (this.requiresMetaModel && metaModels.length === 0)
            return { ok: false, message: 'Set a meta-model binding before publishing.' }

        const store = provider.getRequired(PackageStoreKey)
        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(store, { metaModels, libraries })
        if (problems.length > 0) return { ok: false, message: `Publish blocked: ${problems.join('; ')}.` }

        const sources = await TodlProjectSourceFiles.CollectTaxonomy(storage)
        if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }

        // Record every binding as a pinned dependency so consumers resolve them
        // transitively (the published model.json is own-only).
        const dependencies: PackageRef[] = [
            ...metaModels.map((m) => ({ kind: PackageKind.MetaModel, id: m.id, version: m.version })),
            ...libraries.map((l) => ({ kind: PackageKind.Library, id: l.id, version: l.version })),
        ]
        const outcome = compilePackage(bases, sources, {
            id: manifest.id, version: manifest.packageVersion, name: manifest.name ?? manifest.id,
        }, dependencies)
        if (!outcome.ok || outcome.package === undefined)
            return { ok: false, message: `Publish blocked: ${outcome.errors.length} error(s). Fix them first.` }
        const pkg = outcome.package
        const doc = pkg.document

        // Stamp mural resource keys onto icon apps before persist (same shared pkg.document
        // object), so the key lands in model.json.
        PresentationResourceEmitter.StampResourceKeys(doc)

        const classes: PublishedClass[] = pkg.classes.map((c) => ({ ...c }))
        const scanned = await ProducerResources.Scan(storage, classes.map((c) => c.id))
        for (const c of classes)
        {
            const r = scanned.byClass.get(c.id)
            if (r?.template) c.template = r.template
            if (r?.thumbnail) c.thumbnail = r.thumbnail
            if (r?.doc) c.doc = r.doc
        }

        const bundle: PackageBundle = {
            id: manifest.id, version: manifest.packageVersion, name: manifest.name ?? manifest.id,
            ...(manifest.description !== undefined ? { description: manifest.description } : {}),
            metaModels, libraries,
            classes, assets: scanned.assets, docs: scanned.docs, samples: scanned.samples,
            annotations: projectAnnotations(doc, ProducerProjectFactory.PACKAGE_NODE),
        }

        const dest = store.Storage
        const base = `${manifest.id}/${manifest.packageVersion}`

        // Bake the compiled presentation first — a missing icon blocks the publish before
        // anything is written to the backend.
        const pres = await provider.getRequired(PresentationBakerKey).Bake(storage, dest, base, doc, {
            dictName: this.presentationDict, iconPrefix: this.iconPrefix,
        })
        if (!pres.ok)
            return { ok: false, message: `Publish blocked: missing icon file(s): ${pres.missing.join(', ')}.` }

        await new BlobPackageStore(new StoragePackageSink(dest)).persist(pkg)
        await dest.WriteText(`${base}/${ProducerProjectFactory.BundleFileName}`, JSON.stringify(bundle, null, 2))

        let copied = 0
        for (const folder of ProducerProjectFactory.ResourceFolders)
            copied += await this.copyResourceFolder(storage, dest, folder, base)

        await this.writePresentation(storage, doc, true)

        const warn = scanned.warnings.length > 0
            ? ` (${scanned.warnings.length} warning(s): ${scanned.warnings.join('; ')})`
            : ''
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.packageVersion} — `
                + `${classes.length} class(es), ${sources.length} source(s), ${copied} resource file(s), `
                + `presentation: ${pres.icons} icon(s)${warn}.`,
        }
    }

    // Capability entry point (the "Generate Presentation" command): resolve bases, compile
    // the .todl to a model, then write the presentation dictionary. No .todl / unresolvable
    // base / TODL error → no-op (the Problems dock already surfaces the errors).
    public async regeneratePresentation(storage: IStorage, colored: boolean): Promise<void>
    {
        const sources = await TodlProjectSourceFiles.CollectTaxonomy(storage)
        if (sources.length === 0) return
        const manifest = await this.readManifest(storage)
        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(
            this.Provider.getRequired(PackageStoreKey),
            { metaModels: manifest.metaModels ?? [], libraries: manifest.libraries ?? [] },
        )
        if (problems.length > 0) return
        const { model, diagnostics } = checkAgainst(bases, sources)
        if (diagnostics.some((d) => d.severity === Severity.Error)) return
        await this.writePresentation(storage, toJSON(model), colored)
    }

    private async writePresentation(storage: IStorage, doc: TodlDocument, colored: boolean): Promise<void>
    {
        await storage.WriteText(
            ProducerProjectFactory.PRESENTATION_FILE,
            PresentationResourceEmitter.GenerateAssets(doc, this.presentationDict, colored))
    }

    // Recursively copy one resource folder from the project storage into the bundle at
    // `<destBase>/<folder>/…`. Text formats copy as text; everything else (images) as bytes.
    // A missing folder lists as empty, so this is a no-op when the project doesn't use it.
    private async copyResourceFolder(src: IStorage, dest: IStorage, folder: string, destBase: string): Promise<number>
    {
        let count = 0
        const walk = async (dir: string): Promise<void> => {
            for (const e of await src.List(dir))
            {
                const rel = `${dir}/${e.Name}`
                if (e.IsDirectory) { await walk(rel); continue }
                const destPath = `${destBase}/${rel}`
                if (ProducerProjectFactory.isTextResource(e.Name)) await dest.WriteText(destPath, await src.ReadText(rel))
                else await dest.WriteBytes(destPath, await src.ReadBytes(rel))
                count++
            }
        }
        await walk(folder)
        return count
    }

    private async readManifest(storage: IStorage): Promise<ProducerManifest>
    {
        return JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProducerManifest
    }

    private static isTextResource(name: string): boolean
    {
        return name.endsWith('.mural') || name.endsWith('.md') || name.endsWith('.todl')
    }

    private static slugify(name: string): string
    {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'package'
    }
}
