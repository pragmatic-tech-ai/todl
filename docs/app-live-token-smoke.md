# Live-token smoke — TODL app Packages/Setup/Publish

A manual procedure to verify the app against the **real** GitHub Packages registry
with a token. Not part of CI (it needs a real credential and network).

## Prerequisites

- A GitHub token with `read:packages` (browsing) — and `write:packages` if you also
  want to test **Publish**. See [[project_plexus_installer]] for how the framework
  packages were published to `https://npm.pkg.github.com` under `@pragmatic-tech-ai`.
- Packages already published under the org (e.g. `tech-architecture`, `microsoft`,
  `aws` from the own-content republish).

## Build & launch

```bash
cd TODL
npm run build              # emit dist/ (the app aliases dist/package-manager)
npm --prefix app run dev   # or: npm --prefix app run build && launch the packaged app
```

## Configure the token (Setup page)

Open **Setup** in the left rail, then either:

- **Stored token** — paste the token into "Stored token" → **Save token**. It is
  encrypted at rest with `safeStorage` in `userData/registry-token.bin`; the
  renderer never sees the value.
- **Environment variable** — pick a var (e.g. `GITHUB_TOKEN`) from the ComboBox →
  **Use env var**. The main process resolves `process.env[<name>]` per request; set
  the var before launching (`GITHUB_TOKEN=ghp_… npm --prefix app run dev`).

The status line should read `Token source: … — resolved ✓`.

## Verify browsing (Packages page)

Open **Packages**:

- The master list loads real package names, each with a kind badge
  (meta-model / library).
- Select one → the detail pane shows version + dist-tags, declared dependencies,
  the resolved closure (deps-first), and compiled content (`N nodes · M edges`).
- **Open in Playground** loads that package's `.todl` sources into the editor and
  runs the pipeline.

## Verify publishing (Publish page) — optional, needs `write:packages`

Open **Publish** → **Choose folder…** → pick a packed project dir (one containing
`package.json` + `model.json` + `src/`, i.e. a `packProject` output) →
**Publish to registry**. Status should read `Published <dir> ✓`, and the package
should then appear on the Packages page.

## Notes

- No token configured → Packages shows "No token configured — open Setup to add one."
- The token value is never logged or returned across the IPC bridge; only
  `hasToken` / `tokenSource` / `tokenEnvVar` cross to the renderer.
