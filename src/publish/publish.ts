/**
 * The publish capability: compile sources against bases, gate on errors, derive
 * package metadata, and — via a PackageStore — persist. Compute (`compilePackage`)
 * is pure and I/O-free; persistence flows through an injected store.
 *
 * The persisted `model.json` is OWN-only: it carries only the nodes this package
 * added beyond the seeded base graph (prelude + bases), plus a `dependencies`
 * list naming the bases it was compiled against. Consumers reassemble the closure
 * by resolving those dependencies transitively. `fullDocument` (the closure) is
 * retained on the outcome for presentation / annotation baking.
 */

import { checkAgainst } from "../compiler-services/api.js";
import { ConnectorDeclaration } from "../compiler-services/connectors/connector-declaration.js";
import { toJSON, toJSONOwn, type TodlDocument, type EmitOptions } from "../compiler-services/emit/json.js";
import { Severity, type Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { SourceFile } from "../compiler-services/diagnostics/span.js";
import { CompileFoundation, FoundationKind } from "../compiler-services/stdlib/compile-foundation.js";
import { SecurityNames } from "../compiler-services/security/security-names.js";
import { PackageSecurityCompiler } from "../compiler-services/security/package-security-compiler.js";
import { PackageSecurity, type IPackageSecurity } from "../compiler-services/security/package-security.js";
import { deriveClasses, type PublishedClass } from "./reflect.js";
import type { PackageStore } from "./stores.js";

/** The kind of package a dependency points at (which backend resolves it). */
export enum PackageKind
{
  MetaModel = "meta-model",
  Library = "library",
  Architecture = "architecture",
}

/** A pinned reference to a base package this one was compiled against. */
export interface PackageRef
{
  kind: PackageKind;
  id: string;
  version: string;
}

export interface PackageIdentity
{
  id: string;
  version: string;
  name?: string;
}

/** The persisted model.json shape: a TodlDocument plus recorded base deps. The
 *  extra field is ignored by graphFromJSON and the `bases: TodlDocument[]` input
 *  path, so the base-input contract is unchanged (a superset of TodlDocument). */
export interface PackageDocument extends TodlDocument
{
  dependencies?: PackageRef[];
  security?: IPackageSecurity;       // present only when the package has a security surface
}

/** A verbatim package resource (icon svg, wiki md, binary asset): a package-relative path + bytes. */
export interface PackageResource
{
  path: string;   // package-relative POSIX path, e.g. "resources/az.svg"
  bytes: Uint8Array;
}

export interface CompiledPackage extends PackageIdentity
{
  document: PackageDocument;         // own-only + dependencies — persisted as model.json
  fullDocument: TodlDocument;        // the full compiled closure — for presentation/annotation baking
  sources: readonly SourceFile[];    // raw .todl passthrough (persisted under src/)
  classes: readonly PublishedClass[]; // instantiable palette classes (own-only)
  Security: IPackageSecurity;        // the compiled security surface (PackageSecurity.Empty when none)
  resources?: readonly PackageResource[]; // verbatim asset bytes, persisted under <base>/<path>
}

export interface CompileOutcome
{
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[]; // diagnostics filtered to Severity.Error
  package?: CompiledPackage; // present iff ok
}

export interface PublishOutcome extends CompileOutcome
{
  persisted: boolean;
}

/**
 * Compile sources against bases, gate on errors, and — if clean — build a
 * self-describing CompiledPackage. Pure; no I/O. A failing compile returns no
 * `package`, so callers cannot accidentally persist it.
 *
 * `dependencies` names the base packages the caller resolved into `bases` (by
 * pinned id + version); it is recorded on the own-only `document` for transitive
 * resolution by consumers. Every package but `todl.system` itself compiles over
 * the prelude plus `todl.system`; one that references a system node records
 * `todl.system` as a dependency instead of carrying its nodes.
 */
export function compilePackage(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
  options?: EmitOptions,
  resources?: readonly PackageResource[],
): CompileOutcome
{
  const foundation = identity.id === SecurityNames.SystemModel ? FoundationKind.PreludeOnly : FoundationKind.PreludeAndSystem;
  const { model, diagnostics, provenance, redeclaredConnectors } = checkAgainst([...bases], [...sources], undefined, undefined, foundation);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) return { ok: false, diagnostics, errors };
  // Debug emit reuses the compile's provenance for the `source` field.
  const emit: EmitOptions | undefined = options?.debug ? { debug: true, provenance } : undefined;

  // Own = every node the compile added beyond the seeded base graph. The seed is
  // `mergeBases([...foundation, ...bases])`, so its ids are the union of the
  // foundation documents (prelude, and todl.system unless compiling it) and every
  // base document. (`provenance` only homes instance/model
  // declarations, not taxonomies/concepts/annotations — so it is NOT the
  // own-set.)
  const baseIds = new Set<string>();
  for (const b of [...CompileFoundation.Documents(foundation), ...bases]) for (const n of b.nodes) baseIds.add(n.id);
  // A base datasource the sources redeclare identically is also own (ruling P16), so compose can detect a dependency
  // that later changes it instead of silently re-pointing this package.
  const ownIds = new Set(model.allNodes().filter((n) => !baseIds.has(n.id) || ConnectorDeclaration.IsOwnRedeclaration(n, redeclaredConnectors)).map((n) => n.id));

  // The closure drops the seeded system nodes unless something in it uses them, so an unrelated package's resolved
  // description is unchanged by the foundation.
  const fullDocument = CompileFoundation.WithoutUnusedSystem(foundation, toJSON(model, emit));
  const document: PackageDocument = toJSONOwn(model, ownIds, emit);
  const recorded = [...(dependencies ?? [])];
  if (foundation === FoundationKind.PreludeAndSystem && CompileFoundation.ReferencesSystem(document) && !recorded.some((d) => d.id === SecurityNames.SystemModel))
  {
    recorded.push({ kind: PackageKind.MetaModel, id: SecurityNames.SystemModel, version: SecurityNames.SystemVersion });
  }
  if (recorded.length > 0)
  {
    document.dependencies = recorded;
  }

  const security = PackageSecurityCompiler.Compile(model, ownIds, identity.id);
  if (!PackageSecurityCompiler.IsEmpty(security))
  {
    document.security = security;
  }

  const pkg: CompiledPackage = {
    ...identity,
    document,
    fullDocument,
    sources,
    classes: deriveClasses(document, fullDocument),
    Security: PackageSecurityCompiler.IsEmpty(security) ? PackageSecurity.Empty : security,
  };
  if (resources !== undefined && resources.length > 0)
  {
    pkg.resources = [...resources];
  }
  return { ok: true, diagnostics, errors, package: pkg };
}

/** Compile, and — only if clean — persist the package through the store. */
export async function publish(
  bases: readonly TodlDocument[],
  sources: readonly SourceFile[],
  store: PackageStore,
  identity: PackageIdentity,
  dependencies?: readonly PackageRef[],
  resources?: readonly PackageResource[],
): Promise<PublishOutcome>
{
  const outcome = compilePackage(bases, sources, identity, dependencies, undefined, resources);
  if (!outcome.ok || outcome.package === undefined) return { ...outcome, persisted: false };
  await store.persist(outcome.package);
  return { ...outcome, persisted: true };
}
