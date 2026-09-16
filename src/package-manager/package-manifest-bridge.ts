import { Repository } from "../model/model.js";
import { graphFromJSON } from "../emit/json.js";
import { ManifestEmitter, type DataNode } from "../emit/manifest.js";
import { ManifestWriter } from "../manifest/manifest-writer.js";
import { type LogicalManifest } from "../manifest/logical.js";
import { type ReflectedNode } from "../manifest/reflection/reflection.js";
import type { TodlDocument } from "../emit/json.js";
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

  // A compiled package as a Domain ResolvedPackage. Emits from the FULL closure,
  // so extends/target refs resolve within one self-contained manifest.
  static toResolved(pkg: CompiledPackage): ResolvedPackage {
    const dependencies: DomainPackageRef[] = (pkg.document.dependencies ?? []).map(
      (d) => ({ model: d.id, version: d.version }),
    );
    return PackageManifestBridge.toResolvedDocument(pkg.fullDocument, pkg.id, pkg.version, dependencies);
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
  ): ResolvedPackage {
    const repo = new Repository(graphFromJSON(doc));
    const { manifest, graph } = new ManifestEmitter(repo, model, version).emit();
    const resolved: ResolvedPackage = {
      ref: { model, version },
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
