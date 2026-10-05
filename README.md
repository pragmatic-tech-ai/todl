# @pragmatic-tech-ai/todl

[![CI](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml/badge.svg)](https://github.com/pragmatic-tech-ai/todl/actions/workflows/ci.yml)

Typed substrate for authoring and reasoning over ontologies and taxonomies —
the TypeScript rebuild of the typed-object language (TODL): language +
meta-models + model compiler (a reflective typed graph; load → validate →
emit). ESM, strict TypeScript.

## Develop

```bash
npm ci
npm run build         # gen prelude + compile shippable source (tsconfig.build.json)
npm test              # compiler + lsp (solution-services/lsp) suite
npm run test:corpus   # demos shared/ + examples/ + cli/ (golden snapshots)
```

The `test`/`test:corpus` suites run through `tsx` (transpile-only). The
shippable source is type-checked by `npm run build`; the whole-repo
`npm run typecheck` currently reports pre-existing strict-null errors in test
files only and is not part of the gate.

## Tests-and-demos suite

Sibling folders (`shared/`, `examples/`, `cli/`) are the demos suite — one
verify/compile core reused by a CLI. They are excluded from the published
package (`files: ["dist", "README.md"]`). See
`docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` for the design.

The former Electron demo app (`app/`) has been retired from this repo; it now
lives in the Plexus monorepo as `apps/devUI`, consuming `@pragmatic-tech-ai/todl`
from the registry.

## CI & showcase

- **CI** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs
  `build + test + test:corpus` on every push and pull request. Secret-free.
- **Live showcase** — the playground / gallery / docs app deploys to GitHub
  Pages at **<https://pragmatic-tech-ai.github.io/todl/>** after a green CI run
  on `main` ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

### One-time Pages setup (repo owner)

In **Settings → Pages → Build and deployment**, set **Source = "GitHub
Actions"**. Until this is set, the deploy job fails with a "Pages not enabled"
error; the CI gate is unaffected.

### Deploy token note

The deploy build installs Mural from GitHub Packages (Mural → `todl-runtime`).
These packages live in a different repo, so the Actions `GITHUB_TOKEN` cannot
read them (`403 permission_denied`). The deploy job therefore authenticates
with a **`PACKAGES_TOKEN`** repo secret — a PAT with `read:packages`. If you
rotate that PAT, update the secret (`gh secret set PACKAGES_TOKEN`).

## Syntax checker

`todl-syntax-checker` checks `.todl` files for syntax errors only — lexer and
parser, no semantic validation — so it runs fast in CI, pre-commit hooks and
agent loops, without a language server.

```bash
todl-syntax-checker core/ontology core/models/app.todl
```

Arguments are files or directories; directories are searched recursively,
skipping `node_modules` and hidden directories, and all files are loaded
together. Each diagnostic is printed as `file:line:column  code  message`,
followed by a summary line:

```text
core/models/app.todl:12:18  syntax.unexpected-token  expected "{" at 12:18 (got "-")
files: 7  syntax: 1
```

Exit codes: `0` — no syntax errors, `1` — syntax errors found, `2` — nothing to
check (bad option, unreadable path, or no `.todl` files). Options: `-h`/`--help`,
`-v`/`--version`, and `--` to treat every following argument as a path.

## License

Apache-2.0
