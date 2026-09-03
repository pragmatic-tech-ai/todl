#!/usr/bin/env node
/**
 * The `todl` package-manager CLI (design: todl-package-manager §5 + registry
 * client). `pack` and `install` are local/npm operations; `publish`, `list`,
 * `versions`, and `get` speak the registry protocol directly via {@link NpmRegistry}.
 *
 *   todl pack     [dir] [--scope <s>]
 *   todl install  [dir]
 *   todl publish  [dir] [--scope <s>] [--registry <url>] [--token <t>]
 *   todl list     [--registry <url>] [--scope <s>] [--org <o>] [--github-api <url>] [--token <t>]
 *   todl versions <name> [--registry <url>] [--scope <s>] [--token <t>]
 *   todl get      <name>[@version] [--out <file.tgz>] [--registry <url>] [--scope <s>] [--token <t>]
 *
 * Registry config layers flags → env → .npmrc → defaults (see resolveRegistryConfig).
 */
import {
  packCommand,
  publishCommand,
  installCommand,
  listCommand,
  versionsCommand,
  getCommand,
} from "./commands.js";
import type { RegistryCliOptions } from "./registry/config.js";

interface ParsedArgs {
  positionals: string[];
  flags: RegistryCliOptions;
  out?: string;
}

/** Split argv into positionals and known `--flag value` options. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: RegistryCliOptions = {};
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) break; // trailing flag with no value
    switch (arg.slice(2)) {
      case "registry": flags.registry = value; break;
      case "scope": flags.scope = value; break;
      case "token": flags.token = value; break;
      case "org": flags.org = value; break;
      case "github-api": flags.githubApi = value; break;
      case "out": out = value; break;
      default: break; // unknown flags are ignored
    }
  }
  return out !== undefined ? { positionals, flags, out } : { positionals, flags };
}

const USAGE =
  "usage: todl <pack|install|publish|list|versions|get> [args] [--registry --scope --token --org --github-api --out]";

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { positionals, flags, out } = parseArgs(rest);
  const cwd = ".";

  switch (command) {
    case "pack": {
      const directory = positionals[0] ?? cwd;
      const result = await packCommand(directory, flags.scope !== undefined ? { scope: flags.scope } : {});
      if (!result.ok) {
        console.error(result.errors.map((e) => e.message).join("\n"));
        return 1;
      }
      console.error(`packed ${result.files?.length ?? 0} file(s) to ${directory}/dist`);
      return 0;
    }
    case "install":
      return installCommand(positionals[0] ?? cwd);
    case "publish": {
      const directory = positionals[0] ?? cwd;
      await publishCommand(directory, flags);
      console.error(`published ${directory}`);
      return 0;
    }
    case "list": {
      const names = await listCommand(cwd, flags);
      for (const name of names) console.log(name);
      return 0;
    }
    case "versions": {
      const name = positionals[0];
      if (name === undefined) {
        console.error("usage: todl versions <name>");
        return 1;
      }
      const { versions, distTags } = await versionsCommand(cwd, name, flags);
      for (const version of versions) console.log(version);
      for (const [tag, version] of Object.entries(distTags)) console.error(`  ${tag} -> ${version}`);
      return 0;
    }
    case "get": {
      const ref = positionals[0];
      if (ref === undefined) {
        console.error("usage: todl get <name>[@version] [--out <file.tgz>]");
        return 1;
      }
      const file = await getCommand(cwd, ref, flags, out);
      console.error(`wrote ${file}`);
      return 0;
    }
    default:
      console.error(USAGE);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
