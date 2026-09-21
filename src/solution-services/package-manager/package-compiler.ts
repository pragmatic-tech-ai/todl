/**
 * `PackageCompiler` — the full pack pipeline as one class (design:
 * package-compiler): read a project directory, resolve its declared base bindings
 * into base documents, compile against them (the pure `compilePackage`), and emit
 * the npm package layout through a sink. Base resolution goes through the single
 * `RecursiveProjectReferencesResolver`, reading published `model.json`s from the
 * host-supplied `IProducerStorageBackends`; the app decides what that backend is
 * (a storage root, or — in devUI — an adapter over `node_modules`). I/O (reader,
 * sink) stays injectable so the class is unit-testable.
 */
import { join } from "node:path";
import type { Diagnostic } from "../../compiler-services/diagnostics/diagnostic.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import {
  compilePackage,
  PackageKind,
  type PackageRef,
  type PackageIdentity,
  type CompiledPackage,
} from "../../publish/publish.js";
import type { PackageSink } from "../../publish/stores.js";
import { RecursiveProjectReferencesResolver } from "../project-services/core/base-resolver.js";
import type { IProducerStorageBackends } from "../project-services/core/producer-backends.js";
import type { ProjectBaseModelBindings } from "../project-services/core/base-binding.js";
import { FileSink } from "./sinks.js";
import { readProject, type Project, type ResourceFile } from "./project.js";
import type { ProjectManifest } from "./manifest.js";
import { toPackageJson, DEFAULT_SCOPE, type PackageJson, type TodlPackageMeta } from "./package-json.js";

/** Reads a project directory → manifest + .todl sources. */
export interface ProjectReader
{
  read(directory: string): Project;
}

/** The default reader: node:fs, via the existing `readProject`. */
export class NodeProjectReader implements ProjectReader
{
  read(directory: string): Project
  {
    return readProject(directory);
  }
}

/** Makes the output sink for a directory. */
export type SinkFactory = (outDir: string) => PackageSink;

export interface CompileOptions
{
  /** npm scope override. Default: DEFAULT_SCOPE. */
  scope?: string;
  /** Output directory. Default: `<directory>/dist`. */
  outDir?: string;
}

export interface CompileResult
{
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  /** Package-relative paths written — present iff `ok`. */
  files?: string[];
  /** The in-memory compiled package — present iff `ok`. */
  package?: CompiledPackage;
}

export interface PackageCompilerDeps
{
  reader?: ProjectReader;
  createSink?: SinkFactory;
}

export class PackageCompiler
{
  private readonly reader: ProjectReader;
  private readonly createSink: SinkFactory;

  /** `backends` supplies the published `model.json`s a project's bases resolve
   *  from (the recursive resolver's storage seam). `reader`/`createSink` default
   *  to node:fs. */
  constructor(private readonly backends: IProducerStorageBackends, deps: PackageCompilerDeps = {})
  {
    this.reader = deps.reader ?? new NodeProjectReader();
    this.createSink = deps.createSink ?? ((dir) => new FileSink(dir));
  }

  /** Read → resolve bases → compile → emit. Writes nothing on a failing compile.
   *  Throws for an architecture manifest and for an unresolvable dependency. */
  async compile(directory: string, options: CompileOptions = {}): Promise<CompileResult>
  {
    const project = this.reader.read(directory);
    const scope = options.scope ?? DEFAULT_SCOPE;
    const packageJson = toPackageJson(project.manifest, { scope }); // throws on an architecture

    const bindings: ProjectBaseModelBindings = {
      ...(project.manifest.metaModel !== undefined ? { metaModel: project.manifest.metaModel } : {}),
      ...(project.manifest.libraries !== undefined ? { libraries: project.manifest.libraries } : {}),
    };
    const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(this.backends, bindings);
    if (problems.length > 0)
    {
      throw new Error(`cannot resolve dependencies: ${problems.join("; ")}`);
    }

    const identity: PackageIdentity = { id: packageJson.todl.id, version: packageJson.version, name: project.manifest.name };
    const outcome = compilePackage(bases, project.sources, identity, this.dependencyRefs(project.manifest));
    if (!outcome.ok || outcome.package === undefined)
    {
      return { ok: false, diagnostics: outcome.diagnostics, errors: outcome.errors };
    }

    const sink = this.createSink(options.outDir ?? join(directory, "dist"));
    const files = await this.emit(sink, outcome.package, packageJson, project.resources ?? []);
    return { ok: true, diagnostics: outcome.diagnostics, errors: outcome.errors, files, package: outcome.package };
  }

  /** The pinned dependency refs a manifest declares, as `PackageRef`s. */
  private dependencyRefs(manifest: ProjectManifest): PackageRef[]
  {
    const refs: PackageRef[] = [];
    if (manifest.metaModel !== undefined)
    {
      refs.push({ kind: PackageKind.MetaModel, id: manifest.metaModel.id, version: manifest.metaModel.version });
    }
    for (const library of manifest.libraries ?? [])
    {
      refs.push({ kind: PackageKind.Library, id: library.id, version: library.version });
    }
    return refs;
  }

  /** Write the npm package layout, returning the package-relative paths written. */
  private async emit(sink: PackageSink, pkg: CompiledPackage, packageJson: PackageJson, resources: readonly ResourceFile[]): Promise<string[]>
  {
    const files: string[] = [];
    const write = async (path: string, content: string): Promise<void> => {
      await sink.writeText(path, content);
      files.push(path);
    };
    await write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
    await write("model.json", `${JSON.stringify(pkg.document, null, 2)}\n`);
    for (const source of pkg.sources) await write(`src/${source.uri}`, source.text);
    await write("index.js", PackageCompiler.handleModule(pkg.document, packageJson.todl));
    await write("index.d.ts", PackageCompiler.handleTypes());
    // Every non-`.todl` project file, packed verbatim under `resources/` so the
    // package carries what it needs to work (mural resources, images, docs).
    // Binary-safe when the sink supports it; falls back to a text write.
    for (const r of resources)
    {
      const path = `resources/${r.path}`;
      if (sink.writeBytes !== undefined) await sink.writeBytes(path, r.bytes);
      else await sink.writeText(path, new TextDecoder().decode(r.bytes));
      files.push(path);
    }
    return files;
  }

  /** The embedded handle module: the compiled `model.json` inlined as a
   *  browser-safe ES module (importing the package yields its document, no I/O). */
  private static handleModule(document: TodlDocument, meta: TodlPackageMeta): string
  {
    return [
      "// Generated TODL package handle. The compiled model.json is inlined so that",
      "// importing this package yields its document with no I/O (browser-safe).",
      `export const document = ${JSON.stringify(document)};`,
      `export const meta = ${JSON.stringify(meta)};`,
      "export default document;",
      "",
    ].join("\n");
  }

  /** Types for the handle module (the richer typed-class bridge is a later increment). */
  private static handleTypes(): string
  {
    return [
      "export declare const document: unknown;",
      "export declare const meta: { kind: string; id: string };",
      "declare const _default: unknown;",
      "export default _default;",
      "",
    ].join("\n");
  }
}
