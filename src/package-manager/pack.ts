/**
 * Pack adapter (design: todl-package-manager §3/§5, SP2): compile a project and
 * write the npm package layout — `package.json` (SP1) + `model.json` + `src/` +
 * `index.js` (the embedded handle) + `index.d.ts`. Compilation reuses the existing
 * `compilePackage`; writing goes through a `PackageSink`.
 */
import { compilePackage, PackageKind, type PackageRef, type PackageIdentity } from "../publish/publish.js";
import type { PackageSink } from "../publish/stores.js";
import type { TodlDocument } from "../emit/json.js";
import type { SourceFile } from "../diagnostics/span.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { type ProjectManifest } from "./manifest.js";
import { toPackageJson, type PackageJsonOptions, type TodlPackageMeta } from "./package-json.js";

export interface PackInput {
  manifest: ProjectManifest;
  sources: readonly SourceFile[];
  /** Resolved base documents (meta-model + libraries). Injected here; the SP3
   *  resolve/load adapter will supply them from the installed dependency tree. */
  bases: readonly TodlDocument[];
}

export interface PackResult {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  /** Package-relative paths written, present iff `ok`. */
  files?: string[];
}

/** The pinned dependency refs a manifest declares, as `PackageRef`s. */
function dependencyRefs(manifest: ProjectManifest): PackageRef[] {
  const refs: PackageRef[] = [];
  if (manifest.metaModel !== undefined) {
    refs.push({ kind: PackageKind.MetaModel, id: manifest.metaModel.id, version: manifest.metaModel.version });
  }
  for (const library of manifest.libraries ?? []) {
    refs.push({ kind: PackageKind.Library, id: library.id, version: library.version });
  }
  return refs;
}

/** The embedded handle module: the own `model.json` inlined into a browser-safe ES
 *  module (hybrid-C embedding), so importing the package yields its document with
 *  no filesystem or JSON-import machinery. */
function handleModule(document: TodlDocument, meta: TodlPackageMeta): string {
  return [
    "// Generated TODL package handle. The compiled model.json is inlined so that",
    "// importing this package yields its document with no I/O (browser-safe).",
    `export const document = ${JSON.stringify(document)};`,
    `export const meta = ${JSON.stringify(meta)};`,
    "export default document;",
    "",
  ].join("\n");
}

/** Types for the handle module. The richer generated typed classes (the
 *  `typeof(Class)` bridge) are a later increment. */
function handleTypes(): string {
  return [
    "export declare const document: unknown;",
    "export declare const meta: { kind: string; id: string };",
    "declare const _default: unknown;",
    "export default _default;",
    "",
  ].join("\n");
}

/**
 * Compile `input` and, if clean, write its npm package layout through `sink`. A
 * failing compile writes nothing and returns the diagnostics. Throws for an
 * architecture manifest (not published — built by the application build system).
 */
export async function packProject(
  input: PackInput,
  sink: PackageSink,
  options: PackageJsonOptions = {},
): Promise<PackResult> {
  const { manifest } = input;
  const packageJson = toPackageJson(manifest, options); // throws on an architecture

  const identity: PackageIdentity = { id: packageJson.todl.id, version: packageJson.version, name: manifest.name };
  const outcome = compilePackage(input.bases, input.sources, identity, dependencyRefs(manifest));
  if (!outcome.ok || outcome.package === undefined) {
    return { ok: false, diagnostics: outcome.diagnostics, errors: outcome.errors };
  }

  const pkg = outcome.package;
  const files: string[] = [];
  const write = async (path: string, content: string): Promise<void> => {
    await sink.writeText(path, content);
    files.push(path);
  };

  await write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  await write("model.json", `${JSON.stringify(pkg.document, null, 2)}\n`);
  for (const source of pkg.sources) await write(`src/${source.uri}`, source.text);
  await write("index.js", handleModule(pkg.document, packageJson.todl));
  await write("index.d.ts", handleTypes());

  return { ok: true, diagnostics: outcome.diagnostics, errors: outcome.errors, files };
}
