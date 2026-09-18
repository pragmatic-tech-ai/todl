import { ServiceKey, type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { checkAgainst } from '../../api.js'
import { toJSON, type TodlDocument } from '../../emit/json.js'
import { Severity } from '../../diagnostics/diagnostic.js'
import { compilePackage, PackageKind, type PackageRef } from '../../publish/publish.js'
import { BlobPackageStore } from '../../publish/stores.js'
import {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    type IPresentationProjectFactory,
    type IPublishableProjectFactory,
    type IVersionedProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
    type PublishResult,
} from './project-factory.js'
import { type IProducerProjectFactory } from './producer-project-factory.js'
import { TodlProjectFactory, CLAUDE_MD_FILENAME, type ScaffoldFile } from './todl-project-factory.js'
import { type BaseBindings, type BaseRef } from './base-binding.js'
import { type Project, ProjectNodeKind } from './project.js'
import { TodlSources } from './todl-sources.js'
import { StoragePackageSink } from './storage-package-sink.js'
import { PresentationModel } from './presentation-model.js'
import { BaseResolver } from './base-resolver.js'
import { LibraryResources, type LibraryBundleManifest, type PublishedClass } from './library-bundle.js'
import { PresentationBakerKey } from './presentation-baker.js'
import { ProducerBackendsKey } from './producer-backends.js'
import { LIBRARY_CLAUDE_ROOT } from './scaffold.generated.js'

// The 'library' project type's factory. It mirrors MetaModelProjectFactory, but a
// library is authored AGAINST a meta-model: creation binds a meta-model BaseRef, and
// publish validates every `.todl` with TODL's checkAgainst(base, …) before emitting the
// compiled TodlDocument + sources into the shared libraries backend under
// `<id>/<libVersion>/`, where architecture projects consume it. The presentation bake
// (mural-coupled) and backend resolution (app-coupled) are reached through the
// IPresentationBaker / IProducerBackends seams. All persistence flows through the
// project's rooted IStorage.
interface LibraryManifest extends ProjectManifestEnvelope {
    id: string             // stable publish identity, defaults to slugify(name)
    libVersion: string     // published version, defaults to '0.1.0'
    metaModel?: BaseRef    // the meta-model this library is authored against
    description?: string   // optional human description, carried into library.json
}

export class LibraryProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IProducerProjectFactory, IPresentationProjectFactory, IVersionedProjectFactory {
    public static readonly Key = new ServiceKey<LibraryProjectFactory>('LibraryProjectFactory')
    public static readonly ProjectType = 'library'

    private static readonly PRESENTATION_FILE = 'presentation.generated.mu'
    private static readonly DICT_NAME = 'LibraryPresentation'
    private static readonly ICON_PREFIX = ''

    public readonly typeId = LibraryProjectFactory.ProjectType
    public readonly title = 'Library Project'
    public readonly description = 'Author a technology library (taxonomy) against a meta-model.'

    public readonly requiresMetaModel = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: ProjectNodeKind.Todl, displayName: 'TODL Definition' },
    ]

    public readonly producerKind = ProducerKind.Library

    constructor(provider: IServiceProvider) { super(provider) }

    protected buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope {
        const manifest: LibraryManifest = {
            type: LibraryProjectFactory.ProjectType, name, version: 1,
            id: LibraryProjectFactory.slugify(name), libVersion: '0.1.0',
            ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
        }
        return manifest
    }

    // The library's own scaffold (its CLAUDE.md); the shared TODL manual + rules are
    // added by the base.
    protected scaffoldContributions(): readonly ScaffoldFile[] {
        return [{ path: CLAUDE_MD_FILENAME, content: LIBRARY_CLAUDE_ROOT }]
    }

    public async getVersion(storage: IStorage): Promise<string> {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        return manifest.libVersion
    }

    public async setVersion(storage: IStorage, version: string): Promise<void> {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        manifest.libVersion = version
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Compile the taxonomy sources (samples/ excluded) against the given bases, exactly
    // as publish does. `bases` is the resolved meta-model (+ any libs).
    public async compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        _provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }> {
        const sources = await TodlSources.CollectTaxonomy(storage)
        const { model, diagnostics } = checkAgainst(bases, sources)
        const problems = diagnostics
            .filter((d) => d.severity === Severity.Error)
            .map((d) => d.message)
        return { doc: toJSON(model), problems }
    }

    // Validate every taxonomy `.todl` (samples/ excluded) against the bound meta-model;
    // if clean, emit model.json + library.json + the sources, and copy the resource
    // folders into the libraries backend under `<id>/<libVersion>/`.
    public async publish(_project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult> {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        if (manifest.metaModel === undefined)
            return { ok: false, message: 'Set a meta-model binding before publishing.' }

        const backends = provider.getRequired(ProducerBackendsKey)
        const { bases, problems } = await BaseResolver.Resolve(backends, { metaModel: manifest.metaModel })
        if (problems.length > 0) return { ok: false, message: `Publish blocked: ${problems.join('; ')}.` }

        const sources = await TodlSources.CollectTaxonomy(storage)
        if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }

        // Record the bound meta-model as a pinned dependency so consumers resolve it
        // transitively (the published model.json is own-only).
        const dependencies: PackageRef[] = [
            { kind: PackageKind.MetaModel, id: manifest.metaModel.id, version: manifest.metaModel.version },
        ]
        const outcome = compilePackage(bases, sources, {
            id: manifest.id,
            version: manifest.libVersion,
            name: manifest.name ?? manifest.id,
        }, dependencies)
        if (!outcome.ok || outcome.package === undefined)
            return { ok: false, message: `Publish blocked: ${outcome.errors.length} error(s). Fix them first.` }
        const pkg = outcome.package
        const doc = pkg.document

        // Write mural resource keys onto icon apps before persist (same shared
        // pkg.document object), so the key lands in the library's model.json.
        PresentationModel.StampResourceKeys(doc)

        const classes: PublishedClass[] = pkg.classes.map((c) => ({ ...c }))
        const scanned = await LibraryResources.Scan(storage, classes.map((c) => c.id))
        for (const c of classes) {
            const r = scanned.byClass.get(c.id)
            if (r?.template) c.template = r.template
            if (r?.thumbnail) c.thumbnail = r.thumbnail
            if (r?.doc) c.doc = r.doc
        }

        const bundle: LibraryBundleManifest = {
            id: manifest.id,
            version: manifest.libVersion,
            name: manifest.name ?? manifest.id,
            ...(manifest.description !== undefined ? { description: manifest.description } : {}),
            metaModel: manifest.metaModel,
            classes,
            assets: scanned.assets,
            docs: scanned.docs,
            samples: scanned.samples,
        }

        const dest = backends.Backend(PackageKind.Library)
        const base = `${manifest.id}/${manifest.libVersion}`

        // Bake the compiled presentation first — a missing icon blocks the publish
        // before anything is written to the backend.
        const pres = await provider.getRequired(PresentationBakerKey).Bake(storage, dest, base, doc, {
            dictName: LibraryProjectFactory.DICT_NAME, iconPrefix: LibraryProjectFactory.ICON_PREFIX,
        })
        if (!pres.ok)
            return { ok: false, message: `Publish blocked: missing icon file(s): ${pres.missing.join(', ')}.` }

        // model.json + src/ are written by TODL's BlobPackageStore (the publish spine);
        // library.json is the bundle wrapper, written here.
        await new BlobPackageStore(new StoragePackageSink(dest)).persist(pkg)
        await dest.WriteText(`${base}/library.json`, JSON.stringify(bundle, null, 2))

        // `wiki` ships the concept wiki pages (`annotate wiki { path }`) alongside the
        // package so a consumer resolves them against the package dir.
        let copied = 0
        for (const folder of ['visuals', 'assets', 'docs', 'samples', 'thumbnails', 'resources', 'wiki'])
            copied += await this.copyResourceFolder(storage, dest, folder, base)

        // Keep the project's presentation dictionary current with what was published.
        await this.writePresentation(storage, doc, true)

        const warn = scanned.warnings.length > 0
            ? ` (${scanned.warnings.length} warning(s): ${scanned.warnings.join('; ')})`
            : ''
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.libVersion} — `
                + `${classes.length} class(es), ${sources.length} source(s), ${copied} resource file(s), `
                + `presentation: ${pres.icons} icon(s)${warn}.`,
        }
    }

    // Capability entry point (the "Generate Presentation" command): compile the library's
    // taxonomy .todl against its bound meta-model, then write the presentation dictionary.
    // No .todl / unbound or unresolvable base / TODL error → no-op.
    public async regeneratePresentation(storage: IStorage, colored: boolean): Promise<void> {
        const sources = await TodlSources.CollectTaxonomy(storage)
        if (sources.length === 0) return
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        if (manifest.metaModel === undefined) return
        const backends = this.Provider.getRequired(ProducerBackendsKey)
        const { bases, problems } = await BaseResolver.Resolve(backends, { metaModel: manifest.metaModel })
        if (problems.length > 0) return
        const { model, diagnostics } = checkAgainst(bases, sources)
        if (diagnostics.some((d) => d.severity === Severity.Error)) return
        await this.writePresentation(storage, toJSON(model), colored)
    }

    private async writePresentation(storage: IStorage, doc: TodlDocument, colored: boolean): Promise<void> {
        await storage.WriteText(
            LibraryProjectFactory.PRESENTATION_FILE,
            PresentationModel.GenerateAssets(doc, LibraryProjectFactory.DICT_NAME, colored))
    }

    // Recursively copy one resource folder from the project storage into the bundle at
    // `<destBase>/<folder>/…`. Text formats (.mural/.md/.todl) copy as text; everything
    // else (images) as bytes. A missing folder lists as empty, so this is a no-op when
    // the project doesn't use that folder.
    private async copyResourceFolder(src: IStorage, dest: IStorage, folder: string, destBase: string): Promise<number> {
        let count = 0
        const walk = async (dir: string): Promise<void> => {
            for (const e of await src.List(dir)) {
                const rel = `${dir}/${e.Name}`
                if (e.IsDirectory) { await walk(rel); continue }
                const destPath = `${destBase}/${rel}`
                if (LibraryProjectFactory.isTextResource(e.Name)) await dest.WriteText(destPath, await src.ReadText(rel))
                else await dest.WriteBytes(destPath, await src.ReadBytes(rel))
                count++
            }
        }
        await walk(folder)
        return count
    }

    // Text resource formats copy as text; all others (images) as bytes.
    private static isTextResource(name: string): boolean {
        const ext = TodlSources.Extname(name)
        return ext === '.mural' || ext === '.md' || ext === '.todl'
    }

    private static slugify(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'library'
    }
}
