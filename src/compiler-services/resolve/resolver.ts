/**
 * Namespace-scoped symbol resolver (design: unified-reference-resolver).
 *
 * The single name→node resolution law for the language. Node ids are flat and
 * globally unique; a namespace is a VISIBILITY gate: a reference resolves iff
 * the target's namespace is the reference's own namespace, one of its file's
 * imports, or global (prelude / namespace-less). A qualified `ns.x` resolves
 * the flat node `x` when its namespace is `ns` — explicit, so it needs no
 * import. Used by the loader (every reference) and validate.ts (bindings +
 * constructor scope) so namespace reachability lives in exactly one place.
 */
import type { Repository } from "../model/model.js";
import { NodeIdQualifier } from "../parse/node-id-qualifier.js";
import { PRELUDE_NAMESPACE } from "../stdlib/prelude.js";

// The foundational scalar TYPE keywords (`Scalar = string | number | boolean`).
// They are valid field/param types but are NOT declared nodes, so the resolver
// treats them as always-existing + global (reachable everywhere, never
// rewritten) — a qualified `ns.Concept` field type still gates normally.
const BUILTIN_TYPES: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean"]);

/** A reference's home: the namespace of the file it sits in + that file's
 * imports. A target is reachable iff its namespace is this ns, one of the
 * imports, or global (prelude / namespace-less). */
export interface Home
{
  ns: string;
  imports: readonly string[];
}

export type Resolved =
  | { kind: "ok" }
  | { kind: "qualified"; flat: string }
  | { kind: "unreachable"; ns: string }
  | { kind: "undefined" };

/** The namespace-provenance attr of a model node, or null when unlabeled
 * (prelude / namespace-less / old base). The single reader of a node's
 * namespace — shared by the resolver and validate.ts. */
export function namespaceOf(model: Repository, id: string): string | null
{
  return model.resolve(id)?.namespace ?? null;
}

export interface Resolver
{
  /** The namespace a flat id belongs to, or null for prelude / namespace-less. */
  nsOf(id: string): string | null;
  /** True if `id` is a source-defined or base node. */
  exists(id: string): boolean;
  /** True if a node with flat id `id` is reachable from `home`. */
  reachable(id: string, home: Home): boolean;
  /** Resolve a reference name (bare or qualified) from `home`. */
  resolveRef(name: string, home: Home): Resolved;
}

export function makeResolver(
  model: Repository,
  defined: ReadonlySet<string>,
  sourceNs: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string>,
): Resolver
{
  const nsOf = (id: string): string | null =>
    sourceNs.has(id) ? sourceNs.get(id)! : namespaceOf(model, id);
  const exists = (id: string): boolean => defined.has(id) || model.has(id) || BUILTIN_TYPES.has(id);
  const reachable = (id: string, home: Home): boolean => {
    // Prelude / default-library symbols (its namespace is `todl`) are
    // implicitly imported everywhere, like java.lang — `reserved` is exactly
    // the prelude's declared names, injected by check()/checkAgainst().
    if (reserved.has(id)) return true;
    const ns = nsOf(id);
    return ns === null || ns === home.ns || home.imports.includes(ns);
  };
  // The namespace a bare `name` lives in but which the caller did not import, or
  // null when importing nothing would expose it. Scans source-declared ids then base
  // nodes for a DIRECT namespace member — `<ns>.<name>`, i.e. a node an `import <ns>`
  // would make reachable (first wins). Deliberately NOT a loose local-name match: a
  // nested term `<ns>.<tax>.<name>` is not reachable via a namespace import (it needs
  // `uses`/a qualifier), so it must stay `undefined`, not a misleading "add import".
  const directMemberNs = (id: string, ns: string | null, name: string): string | null =>
    ns !== null && NodeIdQualifier.Qualify(ns, name) === id ? ns : null;
  const resolveRefUnreachableNs = (name: string): string | null => {
    for (const id of defined)
    {
      const ns = directMemberNs(id, nsOf(id), name);
      if (ns !== null) return ns;
    }
    for (const node of model.allNodes())
    {
      const ns = directMemberNs(node.id, node.namespace, name);
      if (ns !== null) return ns;
    }
    return null;
  };
  const resolveRef = (id: string, home: Home): Resolved => {
    // Builtins are global scalar TYPE keywords — never nodes, reachable everywhere,
    // and left exactly as written.
    if (NodeIdQualifier.IsBuiltin(id)) return { kind: "ok" };
    // Written as a CANONICAL id already — an explicit qualifier (`ea.Location`), a
    // prelude/reserved id (`todl.icon`), or a namespace-less base node. An explicit
    // qualifier names its namespace outright, so it needs no import: resolve as
    // written. (Bare names never satisfy `exists` now — every declared id carries
    // its namespace — so this arm only fires for already-qualified / global ids.)
    if (exists(id)) return { kind: "ok" };
    // A BARE name: its canonical id is the name qualified by the home namespace, or
    // by one of that file's imports (first match wins). This is the only place a
    // name→node id is assembled, so the `flat` the caller writes back is qualified.
    const homeQualified = NodeIdQualifier.Qualify(home.ns, id);
    if (exists(homeQualified)) return { kind: "qualified", flat: homeQualified };
    for (const imp of home.imports)
    {
      const imported = NodeIdQualifier.Qualify(imp, id);
      if (exists(imported)) return { kind: "qualified", flat: imported };
    }
    // The prelude (default library, namespace `todl`) is implicitly imported
    // everywhere, like java.lang — a bare `icon` / `identifier` resolves to its
    // `todl.*` node. Tried last so a home-namespace or imported name shadows it.
    const preludeId = NodeIdQualifier.Qualify(PRELUDE_NAMESPACE, id);
    if (exists(preludeId)) return { kind: "qualified", flat: preludeId };
    // The bare name matches no reachable namespace, but it may EXIST in a namespace
    // this file did not import — report `unreachable` (with the namespace to import)
    // rather than `undefined`. Scan the known ids (source-declared + base nodes) for
    // one whose local name matches and that carries a (non-null) namespace. Only runs
    // on the miss path, so the scan cost is paid solely for a failing reference.
    const unreachableNs = resolveRefUnreachableNs(id);
    if (unreachableNs !== null) return { kind: "unreachable", ns: unreachableNs };
    return { kind: "undefined" };
  };
  return { nsOf, exists, reachable, resolveRef };
}
