/**
 * Package-manager commands (design: todl-package-manager §3/§5 + registry client).
 * The programmatic surface behind the `todl` CLI. `pack` compiles a project against
 * its installed dependencies; `install` delegates to npm (dependency-tree building
 * is npm's job); `publish`/`list`/`versions`/`get` speak the registry protocol
 * directly through {@link NpmRegistry} — no `npm publish`, no `npm pack`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TodlDocument } from "../emit/json.js";
import type { ProjectManifest } from "./manifest.js";
import { FileSink } from "./sinks.js";
import { packProject, type PackResult } from "./pack.js";
import { runNpm } from "./npm.js";
import { readInstalledPackages } from "./node-loader.js";
import { resolveClosure, dependencyNames } from "./resolve.js";
import { readProject } from "./project.js";
import { NpmRegistry, type PackageRef, type VersionList } from "./registry/npm-registry.js";
import { resolveRegistryConfig, type RegistryCliOptions } from "./registry/config.js";

export interface PackOptions {
  /** npm scope override (defaults to the configured default). */
  scope?: string;
  /** Output directory for the packed package (defaults to `<project>/dist`). */
  outDir?: string;
}

/** Resolve a project's declared dependencies from its `node_modules` into base
 *  documents for compilation (the SP3 resolve adapter). */
function resolveBases(directory: string, manifest: ProjectManifest, scope?: string): TodlDocument[] {
  const packages = readInstalledPackages(join(directory, "node_modules"));
  const closure = resolveClosure(packages, dependencyNames(manifest, scope));
  return [...closure.metaModels, ...closure.libraries];
}

function outputDir(directory: string, options: PackOptions): string {
  return options.outDir ?? join(directory, "dist");
}

/** A registry client resolved from flags/env/.npmrc under `directory`. */
function registryFor(directory: string, options: RegistryCliOptions): NpmRegistry {
  return new NpmRegistry(resolveRegistryConfig(directory, options, process.env));
}

/** Split a `name` or `name@version` ref (scoped names keep their leading `@`). */
function parseRef(input: string): PackageRef {
  const at = input.lastIndexOf("@");
  if (at > 0) return { name: input.slice(0, at), version: input.slice(at + 1) };
  return { name: input };
}

/** The unscoped tail of a package name, for default output filenames. */
function unscoped(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

/** Compile a project against its installed dependencies and write its npm package
 *  layout to the output directory. */
export function packCommand(directory: string, options: PackOptions = {}): Promise<PackResult> {
  const project = readProject(directory);
  const bases = resolveBases(directory, project.manifest, options.scope);
  return packProject(
    { manifest: project.manifest, sources: project.sources, bases },
    new FileSink(outputDir(directory, options)),
    options.scope !== undefined ? { scope: options.scope } : {},
  );
}

/** Pack then publish over the wire (registry `PUT`). Throws (without publishing) if
 *  the compile fails. */
export async function publishCommand(
  directory: string,
  options: PackOptions & RegistryCliOptions = {},
): Promise<void> {
  const config = resolveRegistryConfig(directory, options, process.env);
  const out = outputDir(directory, options);
  const result = await packCommand(directory, { scope: config.scope, outDir: out });
  if (!result.ok) {
    throw new Error(`pack failed:\n${result.errors.map((e) => e.message).join("\n")}`);
  }
  await new NpmRegistry(config).publishDir(out);
}

/** Install a project's dependencies (delegates to `npm install`). */
export function installCommand(directory: string): Promise<number> {
  return runNpm(["install"], directory);
}

/** List every package name published under the configured org. */
export function listCommand(directory: string, options: RegistryCliOptions = {}): Promise<string[]> {
  return registryFor(directory, options).listPackages();
}

/** List a package's published versions and dist-tags. */
export function versionsCommand(
  directory: string,
  name: string,
  options: RegistryCliOptions = {},
): Promise<VersionList> {
  return registryFor(directory, options).listVersions(name);
}

/** Download a package's tarball to `outFile` (default `<name>-<version>.tgz`,
 *  relative to `directory`). Returns the written path. */
export async function getCommand(
  directory: string,
  refInput: string,
  options: RegistryCliOptions = {},
  outFile?: string,
): Promise<string> {
  const ref = parseRef(refInput);
  const bytes = await registryFor(directory, options).getContent(ref);
  const file = outFile ?? `${unscoped(ref.name)}-${ref.version ?? "latest"}.tgz`;
  writeFileSync(join(directory, file), bytes);
  return file;
}
