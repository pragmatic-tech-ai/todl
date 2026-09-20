/**
 * Resolve/load adapter (design: todl-package-manager §3/§5, SP3). npm has already
 * installed the (flat, exact-pinned) dependency tree; this turns that tree into the
 * ordered, deduped `metaModels[]` + `libraries[]` the runtime `ComposeGraph`
 * consumes. Pure over an in-memory `InstalledPackage[]`; the host-specific
 * discovery (Node node_modules, browser bundled handles) lives in loaders.
 */
import type { TodlDocument } from "../emit/json.js";
import { ProjectType, type ProjectManifest } from "./manifest.js";
import { DEFAULT_SCOPE, type TodlPackageMeta } from "./package-json.js";
import { TODL, type Graph } from "../runtime/index.js";

/** One installed TODL package: its npm name, `todl` block, npm dependency names,
 *  and its compiled `model.json`. */
export interface InstalledPackage
{
  name: string;
  meta: TodlPackageMeta;
  dependencies: string[];
  document: TodlDocument;
}

/** A resolved dependency closure, split by kind in dependency-first order. */
export interface ResolvedClosure
{
  metaModels: TodlDocument[];
  libraries: TodlDocument[];
  /** Resolved package names in load order (deps before dependents). */
  order: string[];
}

/** The npm package names a manifest depends on (meta-model + libraries), scoped. */
export function dependencyNames(manifest: ProjectManifest, scope: string = DEFAULT_SCOPE): string[]
{
  const names: string[] = [];
  if (manifest.metaModel !== undefined) names.push(`${scope}/${manifest.metaModel.id}`);
  for (const library of manifest.libraries ?? []) names.push(`${scope}/${library.id}`);
  return names;
}

/**
 * Resolve the transitive closure of `rootDeps` over the installed packages, ordered
 * deps-first and split by kind. Exact pins mean an id must map to exactly one
 * package — two packages claiming the same `todl.id` is an error, not a silent pick.
 * A dependency name absent from the installed set is a non-TODL npm dep and ignored.
 */
export function resolveClosure(packages: readonly InstalledPackage[], rootDeps: readonly string[]): ResolvedClosure
{
  const byName = new Map(packages.map((p) => [p.name, p]));

  const byId = new Map<string, InstalledPackage>();
  for (const p of packages)
  {
    const existing = byId.get(p.meta.id);
    if (existing !== undefined && existing.name !== p.name)
    {
      throw new Error(`two packages claim TODL id "${p.meta.id}": ${existing.name} and ${p.name}`);
    }
    byId.set(p.meta.id, p);
  }

  const ordered: InstalledPackage[] = [];
  const done = new Set<string>();
  const visit = (name: string, stack: readonly string[]): void => {
    if (done.has(name)) return;
    const pkg = byName.get(name);
    if (pkg === undefined) return; // a non-TODL npm dependency; ignore
    if (stack.includes(name)) throw new Error(`dependency cycle: ${[...stack, name].join(" -> ")}`);
    for (const dep of pkg.dependencies) visit(dep, [...stack, name]);
    done.add(name);
    ordered.push(pkg); // post-order → dependencies precede dependents
  };
  for (const dep of rootDeps) visit(dep, []);

  return {
    metaModels: ordered.filter((p) => p.meta.kind === ProjectType.MetaModel).map((p) => p.document),
    libraries: ordered.filter((p) => p.meta.kind === ProjectType.Library).map((p) => p.document),
    order: ordered.map((p) => p.name),
  };
}

/** Compose a resolved closure into a runtime schema `Graph`. */
export function composeClosure(closure: ResolvedClosure): Graph
{
  return TODL.ComposeGraph(closure.metaModels, closure.libraries);
}
