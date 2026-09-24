import { Repository } from "../../compiler-services/model/model.js";
import { graphFromJSON } from "../../compiler-services/emit/json.js";
import { ManifestEmitter, type DataGraph } from "../../compiler-services/emit/manifest.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import { type LogicalManifest } from "../../manifest/logical.js";
import { type ReflectedNode } from "../../manifest/reflection/reflection.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../publish/publish.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef, SeedGraph, DomainEdge } from "../../domain/domain.js";

// Bridges a compiled package into the artifacts the Domain consumes: SPEC-04
// manifest bytes + declared deps + a seed instance graph. It is a thin adapter
// over the existing ManifestEmitter (Repository -> LogicalManifest + flattened
// DataGraph) plus ManifestWriter.fromLogical (LogicalManifest -> binary). First
// cut is self-contained: it emits from the package's full closure, so extends /
// target refs always resolve within one manifest.
export class PackageManifestBridge
{
  // The logical manifest for a compiled Repository (schema tier only).
  static toLogical(repo: Repository, model: string, version: string): LogicalManifest
  {
    return new ManifestEmitter(repo, model, version).emitManifest();
  }

  // A compiled package as a Domain ResolvedPackage. Emits from the FULL closure,
  // so extends/target refs resolve within one self-contained manifest.
  static toResolved(pkg: CompiledPackage): ResolvedPackage
  {
    const dependencies: DomainPackageRef[] = (pkg.document.dependencies ?? []).map(
      (d) => ({ model: d.id, version: d.version }),
    );
    const resolved = PackageManifestBridge.toResolvedDocument(pkg.fullDocument, pkg.id, pkg.version, dependencies);
    return resolved;
  }

  // A compiled package as a JSON Domain ResolvedPackage (manifest as ManifestJson),
  // for inlining into a page. Emits the manifest from the FULL closure (self-contained);
  // document is the own-only document.
  static toResolvedJson(pkg: CompiledPackage): ResolvedPackage
  {
    const dependencies: DomainPackageRef[] = (pkg.document.dependencies ?? []).map(
      (d) => ({ model: d.id, version: d.version }),
    );
    const resolved = PackageManifestBridge.toResolvedJsonDocument(pkg.fullDocument, pkg.id, pkg.version, dependencies);
    return resolved;
  }

  // The JSON sibling of toResolvedDocument: manifest emitted as ManifestJson, document set.
  static toResolvedJsonDocument(
    doc: TodlDocument,
    model: string,
    version: string,
    dependencies: DomainPackageRef[],
  ): ResolvedPackage
  {
    const repo = new Repository(graphFromJSON(doc));
    const { manifest, graph } = new ManifestEmitter(repo, model, version).emit();
    const resolved: ResolvedPackage = {
      ref: { model, version },
      manifest: ManifestWriter.fromLogical(manifest).toJSON(),
      dependencies,
    };
    const seed = PackageManifestBridge.seedOf(graph);
    if (seed.nodes.length > 0) resolved.seed = seed;
    return resolved;
  }

  // The shared primitive: a TodlDocument + identity + already-mapped Domain deps
  // -> a ResolvedPackage (manifest bytes + seed). Callers pass a full closure for
  // a self-contained manifest, or an own-only document when deps are resolved
  // separately (the Domain loads them deps-first). `seed` is omitted (not
  // undefined) when the document carries no instances.
  static toResolvedDocument(
    doc: TodlDocument,
    model: string,
    version: string,
    dependencies: DomainPackageRef[],
  ): ResolvedPackage
  {
    const repo = new Repository(graphFromJSON(doc));
    const { manifest, graph } = new ManifestEmitter(repo, model, version).emit();
    const resolved: ResolvedPackage = {
      ref: { model, version },
      manifest: ManifestWriter.fromLogical(manifest).toBinary(),
      dependencies,
    };
    const seed = PackageManifestBridge.seedOf(graph);
    if (seed.nodes.length > 0) resolved.seed = seed;
    return resolved;
  }

  // The one DataGraph -> SeedGraph mapper: DataNode -> ReflectedNode (structural-only
  // fields assigned only when present, per exactOptionalPropertyTypes) and DataEdge ->
  // DomainEdge. Edges are omitted when empty; bind folds each edge into the source node's refs.
  static seedOf(graph: DataGraph): SeedGraph
  {
    const nodes: ReflectedNode[] = graph.nodes.map((n) =>
    {
      const node: ReflectedNode = { id: n.id, type: n.type, attrs: n.attrs };
      if (n.class !== undefined) node.class = n.class;
      if (n.namespace.length > 0) node.namespace = n.namespace;
      return node;
    });
    const edges: DomainEdge[] = graph.edges.map((e) => ({ from: e.from, rel: e.rel, to: e.to }));
    return edges.length > 0 ? { nodes, edges } : { nodes };
  }
}
