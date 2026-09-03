/**
 * Resolve {@link NpmRegistryConfig} for the CLI (design: todl-package-manager,
 * registry client). Precedence, highest first: explicit CLI flags → environment
 * variables → `.npmrc` (project then user) → built-in defaults. This mirrors how
 * npm itself layers configuration, so a project already set up to `npm publish`
 * to GitHub Packages works unchanged.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOPE } from "../package-json.js";
import type { NpmRegistryConfig } from "./npm-registry.js";

const DEFAULT_REGISTRY = "https://npm.pkg.github.com";
const DEFAULT_GITHUB_API = "https://api.github.com";
/** Environment variables consulted for the auth token, in order. */
const TOKEN_ENV_VARS = ["NODE_AUTH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN"] as const;

/** The registry-related options a CLI command accepts as flags. */
export interface RegistryCliOptions {
  registry?: string;
  scope?: string;
  token?: string;
  org?: string;
  githubApi?: string;
}

/** Parse an `.npmrc` file into key→value, expanding `${VAR}` from the environment
 *  (npm's own interpolation, common in CI: `_authToken=${NODE_AUTH_TOKEN}`). */
function parseNpmrc(text: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name] ?? "");
    out.set(key, value);
  }
  return out;
}

/** Read and merge `.npmrc` from the project dir then the user home (project wins). */
function readNpmrc(cwd: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const merged = new Map<string, string>();
  for (const path of [join(homedir(), ".npmrc"), join(cwd, ".npmrc")]) {
    if (!existsSync(path)) continue;
    for (const [key, value] of parseNpmrc(readFileSync(path, "utf8"), env)) merged.set(key, value);
  }
  return merged;
}

/** The `.npmrc` auth-token key for a registry URL (`//host/path:_authToken`). */
function authTokenKey(registry: string): string {
  const url = new URL(registry);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `//${url.host}${path}:_authToken`;
}

/**
 * Resolve the full registry config from flags, environment, and `.npmrc` under
 * `cwd`. The token may resolve to `""` (no credential found); authenticated
 * operations then surface a clear HTTP 401 rather than failing opaquely here.
 */
export function resolveRegistryConfig(
  cwd: string,
  flags: RegistryCliOptions,
  env: NodeJS.ProcessEnv,
): NpmRegistryConfig {
  const npmrc = readNpmrc(cwd, env);
  const scope = flags.scope ?? DEFAULT_SCOPE;

  const registry =
    flags.registry ??
    env["NPM_CONFIG_REGISTRY"] ??
    npmrc.get(`${scope}:registry`) ??
    npmrc.get("registry") ??
    DEFAULT_REGISTRY;

  const envToken = TOKEN_ENV_VARS.map((name) => env[name]).find((v) => v !== undefined && v.length > 0);
  const token = flags.token ?? envToken ?? npmrc.get(authTokenKey(registry)) ?? "";

  return {
    registry,
    scope,
    token,
    githubApi: flags.githubApi ?? DEFAULT_GITHUB_API,
    org: flags.org ?? scope.replace(/^@/, ""),
  };
}
