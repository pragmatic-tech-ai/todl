import { Repository } from "../model/model.js";
import { graphFromJSON } from "../emit/json.js";
import { ManifestEmitter, type DataNode } from "../emit/manifest.js";
import { ManifestWriter } from "../manifest/manifest-writer.js";
import { type LogicalManifest } from "../manifest/logical.js";
import { type ReflectedNode } from "../manifest/reflection/reflection.js";
import type { CompiledPackage } from "../publish/publish.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef, SeedGraph } from "../domain/domain.js";

// Bridges a compiled package into the artifacts the Domain consumes: SPEC-04
// manifest bytes + declared deps + a seed instance graph. It is a thin adapter
// over the existing ManifestEmitter (Repository -> LogicalManifest + flattened
// DataGraph) plus ManifestWriter.fromLogical (LogicalManifest -> binary). First
// cut is self-contained: it emits from the package's full closure, so extends /
// target refs always resolve within one manifest.
export class PackageManifestBridge {
  // The logical manifest for a compiled Repository (schema tier only).
  static toLogical(repo: Repository, model: string, version: string): LogicalManifest {
    return new ManifestEmitter(repo, model, version).emitManifest();
  }

  // A compiled package as a Domain ResolvedPackage: manifest bytes, dependency
  // refs (publish `id` -> Domain `model`), and — when the package carries
  // instances — a seed graph. `seed` is omitted (not undefined) when empty.
  static toResolved(pkg: CompiledPackage): ResolvedPackage {
    const repo = new Repository(graphFromJSON(pkg.fullDocument));
    const { manifest, graph } = new ManifestEmitter(repo, pkg.id, pkg.version).emit();
    const dependencies: DomainPackageRef[] = (pkg.document.dependencies ?? []).map(
      (d) => ({ model: d.id, version: d.version }),
    );
    const resolved: ResolvedPackage = {
      ref: { model: pkg.id, version: pkg.version },
      manifest: ManifestWriter.fromLogical(manifest).toBinary(),
      dependencies,
    };
    if (graph.nodes.length > 0) {
      const seed: SeedGraph = {
        nodes: graph.nodes.map((n) => PackageManifestBridge.toReflected(n)),
        edges: graph.edges.map((e) => ({ from: e.from, rel: e.rel, to: e.to })),
      };
      resolved.seed = seed;
    }
    return resolved;
  }

  // A flattened DataNode -> a self-contained ReflectedNode (edges become refs
  // during Domain.bindGraph, so refs are left off here).
  private static toReflected(n: DataNode): ReflectedNode {
    const node: ReflectedNode = { id: n.id, type: n.type, attrs: n.attrs };
    if (n.class !== undefined) node.class = n.class;
    if (n.namespace.length > 0) node.namespace = n.namespace;
    return node;
  }
}
