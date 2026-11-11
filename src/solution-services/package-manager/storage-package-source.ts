import { type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import {
    type IPackageDocumentSource,
    type PackageSource,
    type PackageRef,
    type ResolvedPackage,
} from "../../domain/domain.js";
import { type ResourceSource } from "../../domain/resource-source.js";
import { type ResourceContent } from "../../domain/contributor.js";
import { MimeTypes } from "../../domain/mime-types.js";
import { ManifestEmitter, type DataGraph } from "../../compiler-services/emit/manifest.js";
import { type LogicalManifest } from "../../manifest/logical.js";
import { SystemPackage } from "./system-package.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import { PackageManifestBridge } from "./package-manifest-bridge.js";
import { type PackageDocument } from "../../publish/publish.js";
import { CompileFoundation } from "../../compiler-services/stdlib/compile-foundation.js";
import { MessageTemplate } from "../../compiler-services/diagnostics/message-template.js";

// The disk-backed PackageSource — the SPEC-06 `RegistryPackageSource` the Domain
// comment deferred. It reads the BlobPackageStore on-disk layout
// (`<model>/<version>/model.json`, a PackageDocument) from any IStorage and, on
// resolve, bridges that graph JSON to what Domain.load consumes: it rebuilds a
// Repository over the foundation and the recorded dependency documents (PackageManifestBridge.repositoryOf), emits the LOGICAL manifest + flattened data graph
// (ManifestEmitter), lowers the logical manifest to the SPEC-04 ManifestJson
// (ManifestWriter), and carries the instance graph as the package seed. Because
// publish persists own-only documents that record their base deps, the recorded
// dependencies flow through as domain-tier refs for transitive composition. The
// emitted manifest and seed carry only the package's own nodes (and the prelude):
// the dependency closure is seeded so the document's edges resolve, not re-emitted.
// `todl.system`, which the compile foundation records as a dependency and storage
// never holds, is served from the embedded SystemPackage, so the engine-free Domain
// route loads a package that uses Owned.
export class StoragePackageSource implements PackageSource, IPackageDocumentSource, ResourceSource
{
    private static readonly NotFoundMessage = 'package "{0}@{1}" not found in storage';
    private static readonly VersionSeparator = '@';

    private readonly system = new SystemPackage();

    constructor(private readonly storage: IStorage) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        if (CompileFoundation.ProvidesDependency(ref.model)) return this.system.resolve(ref);
        const version = ref.version ?? (await this.latest(ref.model));
        if (version === undefined) throw new Error(`no versions of package "${ref.model}" in storage`);

        const doc = await this.Document({ model: ref.model, version });
        const dependencyDocuments = await this.DependencyDocuments(doc);
        const repository = PackageManifestBridge.repositoryOf(doc, dependencyDocuments);
        const foreign = StoragePackageSource.ForeignIds(doc, dependencyDocuments);
        const emitted = new ManifestEmitter(repository, ref.model, version).emit();
        const manifest = ManifestWriter.fromLogical(StoragePackageSource.OwnManifest(emitted.manifest, foreign)).toJSON();
        const dependencies = (doc.dependencies ?? []).map((d) => ({ model: d.id, version: d.version }));

        const resolved: ResolvedPackage = { ref: { model: ref.model, version }, manifest, dependencies };
        const seed = PackageManifestBridge.seedOf(StoragePackageSource.OwnGraph(emitted.graph, foreign));
        if (seed.nodes.length > 0) resolved.seed = seed;
        return resolved;
    }

    // The pinned package's persisted own-only document (`<model>/<version>/model.json`); rejects when absent.
    // `todl.system` is the embedded system document.
    public async Document(ref: Required<PackageRef>): Promise<PackageDocument>
    {
        if (CompileFoundation.ProvidesDependency(ref.model)) return this.system.Document(ref);
        const document = await this.TryDocument(ref.model, ref.version);
        if (document === undefined) throw new Error(MessageTemplate.Format(StoragePackageSource.NotFoundMessage, ref.model, ref.version));
        return document;
    }

    // The persisted document at `<model>/<version>/model.json` in one read, or undefined when storage cannot read it
    // (absent); a document that is present but not JSON still throws.
    private async TryDocument(model: string, version: string): Promise<PackageDocument | undefined>
    {
        let text: string;
        try
        {
            text = await this.storage.ReadText(StoragePackageSource.modelPath(model, version));
        }
        catch
        {
            return undefined;
        }
        return JSON.parse(text) as PackageDocument;
    }

    // The ids resolve seeds but must not emit as the package's own: every dependency node and every system node the
    // document does not itself carry (their own packages' manifests and seeds carry them).
    private static ForeignIds(doc: PackageDocument, dependencies: readonly PackageDocument[]): Set<string>
    {
        const foreign = new Set([...dependencies.flatMap((d) => d.nodes.map((n) => n.id)), ...CompileFoundation.SystemIds()]);
        for (const node of doc.nodes) foreign.delete(node.id);
        return foreign;
    }

    // `manifest` without the definitions of `foreign` ids.
    private static OwnManifest(manifest: LogicalManifest, foreign: ReadonlySet<string>): LogicalManifest
    {
        const keep = <T>(defs: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(defs).filter(([id]) => !foreign.has(id)));
        const own: LogicalManifest = { ...manifest, concepts: keep(manifest.concepts), classes: keep(manifest.classes), taxonomies: keep(manifest.taxonomies) };
        if (manifest.aspects !== undefined) own.aspects = keep(manifest.aspects);
        return own;
    }

    // `graph` without the instances of `foreign` ids and the edges from them.
    private static OwnGraph(graph: DataGraph, foreign: ReadonlySet<string>): DataGraph
    {
        return { ...graph, nodes: graph.nodes.filter((n) => !foreign.has(n.id)), edges: graph.edges.filter((e) => !foreign.has(e.from)) };
    }

    // The persisted documents of `doc`'s recorded dependency closure, at their recorded versions (order is immaterial:
    // mergeBases keys by node id). A dependency the compile foundation provides (`todl.system`) is seeded by
    // repositoryOf instead; one storage does not hold is skipped here (resolve still lists it,
    // and the Domain reports it when it loads that dependency).
    private async DependencyDocuments(doc: PackageDocument): Promise<PackageDocument[]>
    {
        const out: PackageDocument[] = [];
        const seen = new Set<string>();
        const queue = [...(doc.dependencies ?? [])];
        while (queue.length > 0)
        {
            const next = queue.shift()!;
            const key = next.id + StoragePackageSource.VersionSeparator + next.version;
            if (seen.has(key) || CompileFoundation.ProvidesDependency(next.id)) continue;
            seen.add(key);
            const dependency = await this.TryDocument(next.id, next.version);
            if (dependency === undefined) continue;
            out.push(dependency);
            queue.push(...(dependency.dependencies ?? []));
        }
        return out;
    }

    // Read a package resource's bytes straight from the blob layout. `uri` is the
    // qualified storage path `<model>/<version>/<path>` — the same layout publish writes.
    public async resource(uri: string): Promise<ResourceContent | undefined>
    {
        if (!(await this.storage.Exists(uri))) return undefined;
        const bytes = await this.storage.ReadBytes(uri);
        return { uri, mime: MimeTypes.Of(uri), bytes };
    }

    // The concrete versions of `model` present in storage, in listing order. A model
    // absent from storage lists as empty (List returns [] for a missing directory).
    public async versions(model: string): Promise<readonly string[]>
    {
        if (CompileFoundation.ProvidesDependency(model)) return this.system.versions(model);
        const entries = await this.storage.List(model);
        return entries.filter((e) => e.IsDirectory).map((e) => e.Name);
    }

    // The semver-latest published version of `model`, or undefined when none exist.
    private async latest(model: string): Promise<string | undefined>
    {
        const versions = [...(await this.versions(model))];
        if (versions.length === 0) return undefined;
        versions.sort((a, b) => StoragePackageSource.compareVersions(b, a));
        return versions[0];
    }

    private static modelPath(model: string, version: string): string
    {
        return `${model}/${version}/model.json`;
    }

    // Compare dotted numeric versions (1.10.0 > 1.9.0); a non-numeric segment sorts
    // by string as a fallback. Sufficient for the local registry's release tags.
    private static compareVersions(a: string, b: string): number
    {
        const pa = a.split(".");
        const pb = b.split(".");
        for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        {
            const na = Number(pa[i] ?? 0);
            const nb = Number(pb[i] ?? 0);
            if (Number.isNaN(na) || Number.isNaN(nb))
            {
                const s = (pa[i] ?? "").localeCompare(pb[i] ?? "");
                if (s !== 0) return s;
                continue;
            }
            if (na !== nb) return na - nb;
        }
        return 0;
    }
}
