# TODL App → Electron + Package Manager Section

**Status**: Design — approved forks, pending spec review
**Date**: 2026-09-04
**Supersedes**: the static GitHub Pages deployment of the TODL demo app

## 1. Context & Goal

The TODL demo app (`app/`) is today a static Vite/Mural single-page app deployed
to GitHub Pages. We want to add a **Package Manager section** that talks to a
**live** npm-compatible registry (GitHub Packages) via the `NpmRegistry` wire
client built in `src/package-manager/registry/`.

A browser can't do this: the auth token can't ship in a static bundle, CORS
blocks `npm.pkg.github.com`, and the client's `publish`/tar/integrity paths use
Node built-ins (`crypto`/`zlib`/`fs`). Rather than work around the browser, we
**migrate the app to Electron** (desktop, Node available in the main process),
which removes every one of those constraints.

Because Mural already renders to a DOM target, the existing renderer runs
**unchanged** inside Electron. The migration is shell + build + an IPC bridge —
not a UI rewrite.

## 2. Locked Decisions

| Fork | Decision |
| --- | --- |
| Deployment target | **Electron-only.** Drop the GitHub Pages build + CI Pages step. |
| Toolchain | **Reuse the Plexus stack**: `electron-vite` (dev/build) + `electron-builder` (packaging) + `electron-updater` + `@electron-toolkit/*`. |
| Registry data | **Live registry client** in the main process (no bundled catalog). |
| Auth token | **Settings UI + `safeStorage`.** Entered in-app, persisted encrypted in `userData`; never in the renderer bundle or repo. |
| Detail pane | **All four**: Metadata · Resolved closure · Compiled content · Open in Playground. |

## 3. Process Model / Architecture

Standard secure Electron topology — `contextIsolation: true`, `nodeIntegration:
false`, `sandbox` per electron-vite defaults:

- **Main (Node)** — window + lifecycle; IPC handlers; the `NpmRegistry` client
  (real network, no CORS); the safeStorage token store; settings persistence in
  `app.getPath("userData")`; the **tar reader** (new) that turns fetched tarball
  bytes into an `InstalledPackage`.
- **Preload** — a single `contextBridge` surface, `window.todl`, the only thing
  crossing into the renderer. Typed; no `ipcRenderer` leakage.
- **Renderer** — the existing Mural/Vite app (moved under `src/renderer/`,
  otherwise unchanged) + the new Packages page. Reaches Node only through the
  bridge; the pure, browser-safe package-manager code (`resolveClosure`,
  `composeClosure`, the compile-for-display pipeline) can also run here directly.

```
┌── Renderer (Chromium) ─────────────┐        ┌── Main (Node) ──────────────────┐
│ Mural app (unchanged)              │        │ NpmRegistry (fetch, no CORS)    │
│ Packages page ── registry-client ──┼─ IPC ──┼─ ipcMain.handle(registry:*)     │
│ Playground / pipeline views        │ preload│ TokenStore (safeStorage)        │
│ resolveClosure/compose (pure) ◄────┼────────┼─ tar reader → InstalledPackage  │
└────────────────────────────────────┘        └─────────────────────────────────┘
```

## 4. SP1 — Electron Shell (no feature change)

Adopt the electron-vite layout, mirroring Plexus (`src/{main,preload,renderer}`).

**Restructure** (`app/`):
- `app/src/*` → `app/src/renderer/src/*` (all current renderer code).
- `app/index.html` → `app/src/renderer/index.html`. Its `<script src="/src/main.ts">`
  is unchanged: with the renderer root at `src/renderer/`, `/src/main.ts` resolves
  to `src/renderer/src/main.ts`.
- `app/vite.config.ts` content (mural plugin, `@pragmatic-tech-ai/todl[/*]`
  aliases to the parent `dist`, `opentype.js` shim, `esbuild.keepNames`,
  `build.target=esnext`, `server.fs.allow`) becomes the **`renderer`** section of
  a new `app/electron.vite.config.ts`.

**New files**:
- `app/src/main/index.ts` — create `BrowserWindow`, load the electron-vite dev
  URL or the built `index.html`; register IPC handlers (stubbed in SP1, filled in
  SP2); wire `electron-updater` (scaffolded, **disabled** until we cut releases).
- `app/src/preload/index.ts` — `contextBridge.exposeInMainWorld("todl", …)`;
  empty surface in SP1, populated in SP2.
- `app/electron.vite.config.ts` — `main` / `preload` / `renderer` sections.
- `app/electron-builder.yml` — appId `com.pragmatic-tech-ai.todl`, productName
  `TODL`, `directories.output: release`, `asar: true`, `win: [msi]`,
  `linux: [AppImage, deb]` with the flat `artifactName` fix from Plexus,
  `publish: github` (owner `pragmatic-tech-ai`, repo TBD).
- `app/tsconfig.node.json` + `app/tsconfig.web.json` (via `@electron-toolkit/tsconfig`).

**package.json** (`app/`):
- `"main": "./out/main/index.js"`.
- devDeps: `electron`, `electron-builder`, `electron-vite`, `@electron-toolkit/{preload,tsconfig,utils}`, `esbuild`.
- deps: `electron-updater`.
- scripts: `dev` (`electron-vite dev`), `build` (`electron-vite build`),
  `start` (`electron-vite preview`), `package[:win|:linux]` (`electron-builder`).

**Repo cleanup** (root `package.json`): remove `app:build:pages`; drop the CI
Pages deploy job. Keep `app:build`/`app:dev` as thin delegators or remove.

**Done when**: `npm --prefix app run dev` opens the app in a desktop window with
the identical UI (Playground / Gallery / Docs), Monaco + the LSP worker working.

## 5. SP2 — Registry IPC Bridge

**Main-process registry**: construct `NpmRegistry` from resolved config
(`resolveRegistryConfig`, defaulting `https://npm.pkg.github.com` +
`@pragmatic-tech-ai`) with the token supplied by the `TokenStore`.

**Token store** (`app/src/main/registry/token-store.ts`):
- `safeStorage.encryptString(token)` → `userData/registry-token.bin`.
- `getToken()` decrypts (or `""` if absent); `setToken(t)` writes; `clear()`.
- If `safeStorage.isEncryptionAvailable()` is false (rare Linux), fall back to an
  in-memory token for the session and warn — never write plaintext.

**Settings** (`app/src/main/registry/settings-store.ts`): registry URL, scope,
org, githubApi as JSON in `userData/registry-settings.json`; defaults from the
constants above.

**IPC channels** (`ipcMain.handle`, all async, typed):
- `registry:list` → `string[]`
- `registry:versions` `(name)` → `{ versions, distTags }`
- `registry:getContent` `(ref)` → `Uint8Array`
- `registry:getPackage` `(ref)` → `InstalledPackage` (getContent + **tar read**)
- `registry:resolveClosure` `(rootDeps)` → resolved closure (fetch each package,
  read it, run `resolveClosure`)
- `registry:publishDir` `(dir)` → `void` (present for completeness; UI use later)
- `config:get` → `{ registry, scope, org, hasToken }` (never returns the token)
- `config:setToken` `(token)` → `void`; `config:setSettings` `(partial)` → `void`

**Tar reader** (new, `src/package-manager/registry/untar.ts`): symmetric to
`tar.ts` — gunzip + parse USTAR blocks → `{ path, bytes }[]`. Plus
`readPackageBytes(bytes): InstalledPackage` (reads `package/package.json` +
`package/model.json`). Lives in the package-manager module (Node-side, reusable
by tests and the CLI), unblocking "compiled content", "open in playground", and
closure resolution. Round-trip tested against `createTgz`.

**Preload surface** (`window.todl`): `{ registry: { list, versions, getContent,
getPackage, resolveClosure, publishDir }, config: { get, setToken, setSettings }
}`, each a thin `ipcRenderer.invoke` wrapper.

**Renderer client** (`app/src/renderer/src/services/registry-client.ts`): typed
wrapper over `window.todl` so page VMs never touch the global. Converts
transferred bytes (`ArrayBuffer`/`Uint8Array`) back to typed results.

**Done when**: a renderer smoke call (`registry-client.list()`) round-trips
through the bridge to a live registry (with a token set) and returns names.

## 6. SP3 — Packages Explorer Page

New page mirroring Gallery's master-detail (`ListBox` + templated detail),
wired in like the others.

**Files** (`app/src/renderer/src/pages/packages/`):
- `packages-vm.ts` — top page VM: loads the package list, holds selection.
- `package-item-vm.ts` — one master-list row (name + kind badge).
- `package-detail-vm.ts` — the detail pane VM (metadata, closure, content,
  actions), populated on selection via `registry-client`.
- `packages.mu` — templates for the page, the list rows, and the detail pane.

**Master**: `registry-client.list()` → rows. A **Settings** affordance (token
field → `config.setToken`) shown when `config.get().hasToken` is false, so an
unauthenticated first run is self-explanatory.

**Detail** (on select):
- **Metadata** — kind (meta-model/library/architecture from the `todl` block),
  version + dist-tags (`registry:versions`), declared dependencies.
- **Resolved closure** — `registry:resolveClosure` over the package's deps,
  rendered deps-first (the real resolver, real installed order).
- **Compiled content** — from `registry:getPackage(ref).document`: node/edge
  counts + reuse of the existing model/graph pipeline views.
- **Open in Playground** — load the package's `src/` (from the read tarball) into
  the Playground editor + pipeline, mirroring `GalleryVM.onOpen`.

**Wiring**: `AppVM` gains `packages` VM + `ShowPackages` command; `shell.mu`
gains a sidebar button; `main.ts` registers the `Packages` dict.

**Done when**: selecting a live package shows all four detail facets and
"Open in Playground" round-trips its sources into the editor.

## 7. Security

- `contextIsolation: true`, `nodeIntegration: false`; renderer reaches Node only
  through the audited `window.todl` surface.
- The token lives only in main (safeStorage-encrypted at rest); `config:get`
  exposes `hasToken: boolean`, never the value.
- No remote code load; renderer loads the packaged `index.html` in production.
- CSP unchanged from the current app (local assets + Google Fonts).

## 8. Testing

- **Tar reader**: unit round-trip `createTgz` → `untar`/`readPackageBytes` (extends
  the existing registry tests). Node-side, no Electron.
- **TokenStore / SettingsStore**: unit tests over a temp `userData` (inject the
  dir), asserting encrypt-at-rest and `hasToken` semantics.
- **IPC handlers**: unit-test the handler functions directly (pure over an
  injected `NpmRegistry` + stores), independent of a running Electron.
- **Renderer client**: unit-test against a stubbed `window.todl`.
- Manual/e2e smoke of the packaged app is out of scope for automated CI here.

Tests live in `tests/` subfolders next to source (repo convention).

## 9. Out of Scope / Deferred

- Auto-update **releases** (electron-updater is scaffolded but off until we
  publish to a GitHub releases repo).
- Publishing *from* the UI (`registry:publishDir` exists but no publish page yet).
- macOS packaging/signing (targets Win + Linux first, like Plexus).
- Multi-window, deep-linking, and any Plexus-style chrome beyond the current app.
- The richer typed-class (`typeof`) bridge in packed `index.d.ts` (separate track).

## 10. Sequencing

SP1 → SP2 → SP3, each verified before the next (the user's stated cadence). SP1
is a pure migration (identical UX); SP2 adds the bridge + tar reader with no UI;
SP3 is the visible feature.
