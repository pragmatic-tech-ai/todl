# TODL App Electron Shell (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the TODL demo app (`app/`) from a static Vite/browser SPA to an Electron desktop app that runs the identical UI in a window — no feature change.

**Architecture:** Adopt electron-vite for dev/build (bundles main, preload, renderer) and electron-builder for packaging, mirroring the Plexus stack. The existing Mural renderer stays **in place** (`app/index.html` + `app/src/**`, unchanged) because it already renders to a DOM target; Electron code is added under a new `app/electron/` tree. The old `vite.config.ts` becomes the `renderer` section of `electron.vite.config.ts`.

**Tech Stack:** electron 43, electron-vite 5, electron-builder 25, electron-updater 6, @electron-toolkit/{utils,preload,tsconfig}, @playwright/test (launch smoke), the existing Mural/Vite renderer.

**Spec:** `docs/superpowers/specs/2026-09-04-todl-app-electron-package-manager-design.md` (SP1 section §4). This plan **refines** the spec's SP1: rather than moving all renderer files under `src/renderer/src/` (which would force rewriting 19 cross-root `../../../../shared|examples` imports), the renderer is left in place and Electron code lives under `app/electron/`. Same outcome — electron-vite + separated main/preload, identical UI — with near-zero import churn. SP2 (registry IPC bridge) and SP3 (packages page) are separate plans.

## Global Constraints

- **No renderer feature/UI change.** SP1 only changes how the app is shelled/built. The Playground/Gallery/Docs UI, Monaco, and the LSP worker must behave identically.
- **Secure Electron defaults:** `contextIsolation: true`, `nodeIntegration: false`. The renderer reaches Node only through the preload `contextBridge` (empty in SP1).
- **Renderer stays put:** do not move `app/index.html` or any file under `app/src/`. Do not edit renderer `.ts`/`.mu` files.
- **Node 22** for any `node --test` / Playwright run (the repo's test scripts pass globs to `node --test`, which needs ≥21).
- **Package versions (verbatim):** `electron@^43.0.0`, `electron-vite@^5.0.0`, `electron-builder@^25.1.8`, `electron-updater@^6.8.9`, `@electron-toolkit/utils@^4.0.0`, `@electron-toolkit/preload@^3.0.2`, `@electron-toolkit/tsconfig@^2.0.0`, `esbuild@^0.25.0`, `@playwright/test@^1.48.0`.
- **App identity (verbatim):** appId `com.pragmatic-tech-ai.todl`, productName `TODL`.
- **Tests** live in a `tests/` subfolder next to source (repo convention).
- **Commits:** the user commits on their own cadence and nothing is pushed. The `git commit` steps below are grouping guidance — stage the changes and let the user decide when to commit; do not `git push`.

---

### Task 1: Toolchain + package.json wiring

Add the Electron toolchain to `app/` and switch its build scripts from raw Vite to electron-vite. No Electron code yet — this task just makes the tooling installable and the scripts present.

**Files:**
- Modify: `app/package.json`

**Interfaces:**
- Produces: the `app` npm scripts `dev`/`build`/`start`/`package`/`package:win`/`package:linux`/`test:e2e`, and `"main": "./out/main/index.js"` consumed by Electron in later tasks.

- [ ] **Step 1: Rewrite `app/package.json` scripts, main field, and deps**

Replace the `"scripts"`, add `"main"`, and extend `"dependencies"`/`"devDependencies"` so the file reads:

```json
{
  "name": "todl-demo-app",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "package": "npm run build && electron-builder",
    "package:win": "npm run build && electron-builder --win",
    "package:linux": "npm run build && electron-builder --linux",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@pragmatic-tech-ai/mural": "file:../../Mural",
    "electron-updater": "^6.8.9",
    "monaco-editor": "^0.52.0",
    "opentype.js": "^2.0.0",
    "vscode-jsonrpc": "^8.2.0",
    "vscode-languageserver": "^9.0.1",
    "vscode-languageserver-textdocument": "^1.0.12",
    "vscode-languageserver-types": "^3.17.5"
  },
  "devDependencies": {
    "@electron-toolkit/preload": "^3.0.2",
    "@electron-toolkit/tsconfig": "^2.0.0",
    "@electron-toolkit/utils": "^4.0.0",
    "@playwright/test": "^1.48.0",
    "electron": "^43.0.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^5.0.0",
    "esbuild": "^0.25.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm --prefix app install`
Expected: completes; `app/node_modules/electron`, `electron-vite`, `electron-builder` present.

- [ ] **Step 3: Verify the toolchain resolves**

Run: `npm --prefix app ls electron electron-vite electron-builder --depth=0`
Expected: all three listed at the pinned majors (43 / 5 / 25).

- [ ] **Step 4: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "build(app): add electron-vite/electron-builder toolchain"
```

---

### Task 2: Electron main, preload, and electron-vite config

Add the Electron entry points and the electron-vite config whose `renderer` section reproduces the current `vite.config.ts`. After this task the app builds to `app/out/{main,preload,renderer}`.

**Files:**
- Create: `app/electron/main/index.ts`
- Create: `app/electron/main/auto-update.ts`
- Create: `app/electron/preload/index.ts`
- Create: `app/electron.vite.config.ts`
- Create: `app/tsconfig.node.json`
- Delete: `app/vite.config.ts` (its content moves into the config's `renderer` section)

**Interfaces:**
- Consumes: `"main": "./out/main/index.js"` (Task 1).
- Produces: build outputs `app/out/main/index.js`, `app/out/preload/index.js`, `app/out/renderer/index.html`; a global `window.todl` (empty object) that SP2 extends.

- [ ] **Step 1: Create the main process entry**

`app/electron/main/index.ts`:

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";
import { initAutoUpdate } from "./auto-update.js";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: "#1C1B1F", // Mural dark @Surface — no white flash on load
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on("ready-to-show", () => window.show());

  if (is.dev && process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.pragmatic-tech-ai.todl");
  // Auto-update is scaffolded but disabled until we cut releases (spec §9).
  if (process.env["TODL_ENABLE_UPDATES"] === "1") initAutoUpdate();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 2: Create the disabled auto-update scaffold**

`app/electron/main/auto-update.ts`:

```ts
/**
 * Auto-update scaffold (spec §9). Present for stack parity with Plexus, but only
 * invoked when TODL_ENABLE_UPDATES=1 — releases are deferred, so this is dormant.
 */
import { autoUpdater } from "electron-updater";

export function initAutoUpdate(): void {
  autoUpdater.autoDownload = false;
  void autoUpdater.checkForUpdatesAndNotify();
}
```

- [ ] **Step 3: Create the preload (empty bridge for SP1)**

`app/electron/preload/index.ts`:

```ts
import { contextBridge } from "electron";

// SP1: expose an empty namespace so contextIsolation is wired end-to-end.
// SP2 populates `todl.registry` / `todl.config`.
contextBridge.exposeInMainWorld("todl", {});
```

- [ ] **Step 4: Create `app/electron.vite.config.ts`**

Copy the aliases/plugins from the existing `app/vite.config.ts` into the `renderer` section:

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(here, "electron/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(here, "electron/preload/index.ts") } },
  },
  renderer: {
    root: here,
    plugins: [vitePluginMural()],
    // Mural resolves themes/DataTemplates by runtime Class.name — do not rename.
    esbuild: { keepNames: true },
    build: {
      target: "esnext", // top-level await in the renderer bootstrap
      rollupOptions: { input: resolve(here, "index.html") },
    },
    resolve: {
      alias: [
        { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(repoRoot, "dist/language-server/index.js") },
        { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(repoRoot, "dist/language-service/index.js") },
        { find: /^@pragmatic-tech-ai\/todl$/, replacement: resolve(repoRoot, "dist/index.js") },
        { find: /^opentype\.js$/, replacement: resolve(here, "src/opentype-shim.mjs") },
      ],
    },
    server: { fs: { allow: [repoRoot, resolve(repoRoot, "..", "Mural")] } },
  },
});
```

- [ ] **Step 5: Delete the old renderer-only Vite config**

Run: `git rm app/vite.config.ts`
(Its content now lives in the `renderer` section above; electron-vite is the single config.)

- [ ] **Step 6: Create `app/tsconfig.node.json` for the Electron code**

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["electron/**/*.ts", "electron.vite.config.ts"],
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node", "node"]
  }
}
```

- [ ] **Step 7: Build**

Run: `npm run build && npm --prefix app run build`
(The root `npm run build` produces `dist/` that the renderer aliases point at; then electron-vite builds the app.)
Expected: creates `app/out/main/index.js`, `app/out/preload/index.js`, `app/out/renderer/index.html`.

- [ ] **Step 8: Verify the outputs exist**

Run: `ls app/out/main/index.js app/out/preload/index.js app/out/renderer/index.html`
Expected: all three print (no "No such file").

- [ ] **Step 9: Commit**

```bash
git add app/electron app/electron.vite.config.ts app/tsconfig.node.json
git rm app/vite.config.ts
git commit -m "feat(app): add electron main/preload + electron-vite config"
```

---

### Task 3: Launch smoke test (Playwright _electron)

Prove the whole shell works: the built Electron app launches, the renderer mounts, and Mural has drawn (an `<svg>` under `#app`). This is SP1's automated acceptance.

**Files:**
- Create: `app/playwright.config.ts`
- Create: `app/tests/smoke/launch.spec.ts`

**Interfaces:**
- Consumes: the build outputs from Task 2 (`app/out/main/index.js`).

- [ ] **Step 1: Create `app/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
});
```

- [ ] **Step 2: Write the failing smoke test**

`app/tests/smoke/launch.spec.ts`:

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("app launches in a window and the renderer mounts", async () => {
  // Strip ELECTRON_RUN_AS_NODE: when launched from a Node/tsx context it makes
  // Electron run as plain Node instead of booting the app (known gotcha).
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];

  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  await expect(window.locator("#app svg").first()).toBeVisible();
  await app.close();
});
```

- [ ] **Step 3: Run it to verify it fails without a build**

Run: `rm -rf app/out && npm --prefix app run test:e2e`
Expected: FAIL — the test cannot find `app/out/main/index.js` (renderer never mounts).

- [ ] **Step 4: Build, then run the smoke test**

Run: `npm run build && npm --prefix app run build && npm --prefix app run test:e2e`
Expected: PASS — window opens, `#app svg` becomes visible.

- [ ] **Step 5: Commit**

```bash
git add app/playwright.config.ts app/tests/smoke/launch.spec.ts
git commit -m "test(app): add electron launch smoke (playwright _electron)"
```

---

### Task 4: electron-builder packaging config

Add the packaging manifest so `electron-builder` can produce installers, mirroring Plexus. Verification uses `--dir` (an unpacked app, fast) rather than a full installer.

**Files:**
- Create: `app/electron-builder.yml`
- Modify: `app/.gitignore` (create if absent)

**Interfaces:**
- Consumes: `app/out/**` (Task 2 build output).

- [ ] **Step 1: Create `app/electron-builder.yml`**

```yaml
appId: com.pragmatic-tech-ai.todl
productName: TODL
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
asar: true
win:
  target: [msi]
linux:
  target: [AppImage, deb]
  category: Development
  maintainer: Pragmatic Lab <evgen.napryaglo@gmail.com>
  # Scoped package name -> the deb default artifactName turns the scope slash
  # into a path separator and fpm fails. Pin to productName so artifacts stay flat.
  artifactName: ${productName}-${version}-${arch}.${ext}
publish:
  provider: github
  owner: pragmatic-tech-ai
  # repo left unset until releases are enabled (spec §9).
```

- [ ] **Step 2: Ignore build/release output**

`app/.gitignore` (append, or create with):

```
out/
release/
dist/
```

- [ ] **Step 3: Produce an unpacked app**

Run: `npm run build && npm --prefix app run build && npx --prefix app electron-builder --dir`
Expected: creates `app/release/<platform>-unpacked/` containing the TODL executable; no errors.

- [ ] **Step 4: Verify the unpacked app exists**

Run (Windows): `ls app/release/win-unpacked/TODL.exe`
Expected: prints the path (on Linux: `ls app/release/linux-unpacked/todl`).

- [ ] **Step 5: Commit**

```bash
git add app/electron-builder.yml app/.gitignore
git commit -m "build(app): add electron-builder packaging config"
```

---

### Task 5: Remove the GitHub Pages deployment

The app is Electron-only now. Delete the Pages deploy workflow and the root `app:build:pages` script, and repoint the root `app:*` delegators at electron-vite.

**Files:**
- Delete: `.github/workflows/deploy.yml`
- Modify: `package.json` (root, `scripts`)

**Interfaces:** none (removal + script cleanup).

- [ ] **Step 1: Delete the Pages workflow**

Run: `git rm .github/workflows/deploy.yml`
(`.github/workflows/ci.yml` is unaffected — it builds + tests the todl core, not the app.)

- [ ] **Step 2: Update the root `app:*` scripts**

In the root `package.json` `scripts`, remove `app:build:pages` and repoint the delegators:

```json
    "app:build": "npm run build && npm --prefix app run build",
    "app:dev": "npm run build && npm --prefix app run dev",
    "app:verify": "node app/src/ui-verify/render-check.mjs",
```

(`app:dev` now runs the root build first so the renderer's `@pragmatic-tech-ai/todl` alias to `dist/` resolves before Electron starts. `app:build:pages` is gone.)

- [ ] **Step 3: Verify no Pages references remain**

Run: `grep -rn "pages\|deploy-pages\|upload-pages" .github package.json app/package.json`
Expected: no matches (or only unrelated words); specifically no `app:build:pages`, no `deploy.yml`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git rm .github/workflows/deploy.yml
git commit -m "build: drop GitHub Pages deploy (app is Electron-only)"
```

---

## Self-Review

**1. Spec coverage (SP1, §4):**
- electron-vite layout + Plexus stack → Tasks 1–2, 4. ✓ (refined: renderer stays in place, Electron under `app/electron/` — deviation documented in the header.)
- `main`/`preload` + `electron.vite.config.ts` (renderer = old vite.config) → Task 2. ✓
- `electron-builder.yml` mirroring Plexus (appId/productName/targets/artifactName fix/github publish) → Task 4. ✓
- electron-updater scaffolded but disabled → Task 2 (`auto-update.ts`, gated on `TODL_ENABLE_UPDATES`). ✓
- Drop `app:build:pages` + CI Pages step → Task 5. ✓
- "Done when `dev` opens identical UI" → Task 3 automated launch smoke. ✓
- `tsconfig.node.json` (+ `@electron-toolkit/tsconfig`) → Task 2. ✓ (`tsconfig.web.json` for the renderer is deferred: SP1 changes no renderer TS and electron-vite transpiles without it; add in SP2 when renderer imports the bridge types.)

**2. Placeholder scan:** No TBD/TODO in steps; every file has full content. The single intentional omission (electron-builder `publish.repo`) is called out with rationale (releases deferred, spec §9), not a silent gap.

**3. Type/name consistency:** `initAutoUpdate` defined in `auto-update.ts` and called in `main/index.ts` — match. `window.todl` empty object in preload, extended (not redefined) in SP2. Build output paths (`out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`) referenced consistently across Tasks 2–4. Script names (`build`, `test:e2e`) consistent between Task 1 definitions and Tasks 3–4 usage.
