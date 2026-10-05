import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { check } from "../compiler-services/api.js";
import type { Diagnostic } from "../compiler-services/diagnostics/diagnostic.js";
import type { SourceFile } from "../compiler-services/diagnostics/span.js";

export const USAGE = `usage: todl-syntax-checker [options] <file-or-dir>...

Checks .todl files for syntax errors only (lexer and parser); semantic
diagnostics are not reported. Directories are searched recursively, skipping
node_modules and hidden directories. All files are loaded together.

options:
  -h, --help     show this help
  -v, --version  print the version
  --             treat every following argument as a path

exit codes:
  0  no syntax errors
  1  syntax errors found
  2  nothing to check: bad option, unreadable path, or no .todl files
`;

export function isSyntaxDiagnostic(diagnostic: Diagnostic): boolean
{
  return diagnostic.code.startsWith("syntax.");
}

/** Load every source together and keep only lex/parse diagnostics. */
export function syntaxDiagnostics(sources: readonly SourceFile[]): Diagnostic[]
{
  return check([...sources]).diagnostics.filter(isSyntaxDiagnostic);
}

/** Directories a recursive search does not enter: dependencies and hidden folders (.git, …). */
function isSkippedDirectory(name: string): boolean
{
  return name === "node_modules" || name.startsWith(".");
}

/**
 * A `.todl` file as-is, or every `.todl` file under a directory. The search
 * skips `node_modules` and hidden directories below the given one; a path
 * named explicitly is always read.
 */
export function collectTodlPaths(path: string): string[]
{
  const info = statSync(path);
  if (info.isFile()) return path.endsWith(".todl") ? [path] : [];
  const out: string[] = [];
  for (const entry of readdirSync(path))
  {
    const child = join(path, entry);
    if (statSync(child).isDirectory())
    {
      if (!isSkippedDirectory(entry)) out.push(...collectTodlPaths(child));
    }
    else if (entry.endsWith(".todl")) out.push(child);
  }
  return out.sort();
}

/** Keep the first spelling of every file, so a file named twice (directly and through its directory) loads once. */
export function uniquePaths(paths: readonly string[]): string[]
{
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths)
  {
    const key = resolve(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function readSources(paths: readonly string[]): SourceFile[]
{
  return paths.map((uri) => ({ uri, text: readFileSync(uri, "utf8") }));
}

export function formatDiagnostic(diagnostic: Diagnostic): string
{
  const uri = diagnostic.span?.uri ?? "";
  const line = diagnostic.span?.start.line ?? "?";
  const column = diagnostic.span?.start.column ?? "?";
  const message = diagnostic.message.split("\n")[0] ?? "";
  return `${uri}:${line}:${column}  ${diagnostic.code}  ${message}`;
}

/** The version of the package, read from its package.json (two levels up from src/ and from dist/). */
export function packageVersion(): string
{
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
  return manifest.version ?? "unknown";
}

export interface CheckIO
{
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIO: CheckIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/**
 * Check `.todl` files and directories. Returns 0 when none have syntax
 * diagnostics, 1 when any do, and 2 when the arguments cannot be checked.
 * `--help` and `--version` print to stdout and return 0.
 */
export function runSyntaxCheck(argv: readonly string[], io: CheckIO = defaultIO): number
{
  const args: string[] = [];
  let optionsEnded = false;
  for (const arg of argv)
  {
    if (optionsEnded || !arg.startsWith("-") || arg === "-")
    {
      args.push(arg);
      continue;
    }
    switch (arg)
    {
      case "--":
        optionsEnded = true;
        break;
      case "-h":
      case "--help":
        io.stdout(USAGE);
        return 0;
      case "-v":
      case "--version":
        io.stdout(`${packageVersion()}\n`);
        return 0;
      default:
        io.stderr(`todl-syntax-checker: unknown option ${arg}\nTry 'todl-syntax-checker --help'.\n`);
        return 2;
    }
  }

  if (args.length === 0)
  {
    io.stderr(USAGE);
    return 2;
  }

  const collected: string[] = [];
  for (const arg of args)
  {
    try
    {
      collected.push(...collectTodlPaths(arg));
    }
    catch
    {
      io.stderr(`todl-syntax-checker: cannot read ${arg}\n`);
      return 2;
    }
  }
  const paths = uniquePaths(collected);
  if (paths.length === 0)
  {
    io.stderr("todl-syntax-checker: no .todl files\n");
    return 2;
  }

  const diagnostics = syntaxDiagnostics(readSources(paths));
  for (const diagnostic of diagnostics) io.stdout(`${formatDiagnostic(diagnostic)}\n`);
  io.stdout(`files: ${paths.length}  syntax: ${diagnostics.length}\n`);
  return diagnostics.length > 0 ? 1 : 0;
}
