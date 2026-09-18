import { type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import {
    type PackageSource,
    type PackageRef,
    type ResolvedPackage,
    type SeedGraph,
    type DomainEdge,
} from "../domain/domain.js";
import { type ReflectedNode } from "../manifest/reflection/reflection.js";
import { fromJSON } from "../emit/json.js";
import { ManifestEmitter, type DataGraph } from "../emit/manifest.js";
import { ManifestWriter } from "../manifest/manifest-writer.js";
import { type PackageDocument } from "../publish/publish.js";

// The disk-backed PackageSource — the SPEC-06 `RegistryPackageSource` the Domain
// comment deferred. It reads the BlobPackageStore on-disk layout
// (`<model>/<version>/model.json`, a PackageDocument) from any IStorage and, on
// resolve, bridges that graph JSON to what Domain.load consumes: it rebuilds a
// Repository (fromJSON), emits the LOGICAL manifest + flattened data graph
// (ManifestEmitter), lowers the logical manifest to the SPEC-04 ManifestJson
// (ManifestWriter), and carries the instance graph as the package seed. Because
// publish persists own-only documents that record their base deps, the recorded
// dependencies flow through as domain-tier refs for transitive composition.
export class StoragePackageSource implements PackageSource {
    constructor(private readonly storage: IStorage) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage> {
        const version = ref.version ?? (await this.latest(ref.model));
        if (version === undefined) throw new Error(`no versions of package "${ref.model}" in storage`);

        const path = StoragePackageSource.modelPath(ref.model, version);
        if (!(await this.storage.Exists(path))) throw new Error(`package "${ref.model}@${version}" not found in storage`);

        const doc = JSON.parse(await this.storage.ReadText(path)) as PackageDocument;
        const { manifest: logical, graph } = new ManifestEmitter(fromJSON(doc), ref.model, version).emit();
        const manifest = ManifestWriter.fromLogical(logical).toJSON();
        const dependencies = (doc.dependencies ?? []).map((d) => ({ model: d.id, version: d.version }));

        const resolved: ResolvedPackage = { ref: { model: ref.model, version }, manifest, dependencies };
        const seed = StoragePackageSource.toSeed(graph);
        if (seed.nodes.length > 0) resolved.seed = seed;
        return resolved;
    }

    // The concrete versions of `model` present in storage, in listing order. A model
    // absent from storage lists as empty (List returns [] for a missing directory).
    public async versions(model: string): Promise<readonly string[]> {
        const entries = await this.storage.List(model);
        return entries.filter((e) => e.IsDirectory).map((e) => e.Name);
    }

    // The semver-latest published version of `model`, or undefined when none exist.
    private async latest(model: string): Promise<string | undefined> {
        const versions = [...(await this.versions(model))];
        if (versions.length === 0) return undefined;
        versions.sort((a, b) => StoragePackageSource.compareVersions(b, a));
        return versions[0];
    }

    // Map the emitter's flattened data graph to a Domain seed: DataNode -> ReflectedNode
    // and DataEdge -> DomainEdge (identical `{from,rel,to}`; bindGraph folds each edge
    // into the source node's `refs`). Structural-only fields are assigned when present
    // to satisfy exactOptionalPropertyTypes.
    private static toSeed(graph: DataGraph): SeedGraph {
        const nodes: ReflectedNode[] = graph.nodes.map((dn) => {
            const node: ReflectedNode = { id: dn.id, type: dn.type, attrs: dn.attrs };
            if (dn.class !== undefined) node.class = dn.class;
            if (dn.namespace !== "") node.namespace = dn.namespace;
            return node;
        });
        const edges: DomainEdge[] = graph.edges.map((e) => ({ from: e.from, rel: e.rel, to: e.to }));
        return edges.length > 0 ? { nodes, edges } : { nodes };
    }

    private static modelPath(model: string, version: string): string {
        return `${model}/${version}/model.json`;
    }

    // Compare dotted numeric versions (1.10.0 > 1.9.0); a non-numeric segment sorts
    // by string as a fallback. Sufficient for the local registry's release tags.
    private static compareVersions(a: string, b: string): number {
        const pa = a.split(".");
        const pb = b.split(".");
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const na = Number(pa[i] ?? 0);
            const nb = Number(pb[i] ?? 0);
            if (Number.isNaN(na) || Number.isNaN(nb)) {
                const s = (pa[i] ?? "").localeCompare(pb[i] ?? "");
                if (s !== 0) return s;
                continue;
            }
            if (na !== nb) return na - nb;
        }
        return 0;
    }
}
