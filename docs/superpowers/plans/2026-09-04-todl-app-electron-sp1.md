# TODL App Electron Shell (SP1) Implementation Plan — canonical layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the TODL demo app (`app/`) from a static Vite/browser SPA to an Electron desktop app in the **canonical electron-vite layout** (`src/{main,preload,renderer}`), running the identical UI in a window — no feature change.

**Architecture:** Adopt the standard electron-vite project structure (the shape `npm create @quick-start/electron` produces): main and preload under `src/main` / `src/preload`, the existing Mural renderer relocated under `src/renderer/` (html at `src/renderer/index.html`, code at `src/renderer/src/**`). electron-vite uses its **default roots** (no custom `root`/`input`). The renderer's bespoke config (Mural vite plugin, `@pragmatic-tech-ai/todl` dist aliases, opentype shim, `keepNames`, `fs.allow`) is ported into the config's `renderer` section, and the renderer's 19 cross-root imports to repo `shared/`/`examples/` are converted to stable `@shared`/`@examples` aliases (fixed once, not by hand-rewriting depth). electron-builder handles packaging. **No auto-update** (this is a demo app).

**Tech Stack:** electron 43, electron-vite 5, electron-builder 25, @electron-toolkit/{utils,preload,tsconfig}, @playwright/test (launch smoke), the existing Mural/Vite renderer (vite 7).

**Spec:** `docs/superpowers/specs/2026-09-04-todl-app-electron-package-manager-design.md` (SP1 §4). This plan implements SP1 §4's canonical `src/renderer/` restructure. It **drops electron-updater entirely** (user ruling: a demo app needs no auto-update; §9's "scaffolded but off" becomes "removed").

## Global Constraints

- **No renderer feature/UI change.** Files move and their `shared`/`examples` import specifiers change to aliases; **no other renderer edits**. Playground/Gallery/Docs, Monaco, and the LSP worker must behave identically.
- **Main and preload MUST be CJS.** Do NOT add `"type": "module"` to `app/package.json` — Electron 43 crashes on ESM `electron` imports in a standalone main. This is why `main/index.ts` uses `__dirname` (valid in CJS). (Verified in a prior run.)
- **The `tests/` subtree needs its own `app/tests/package.json` = `{"type":"module"}`** so Playwright's transform keeps `import.meta.url` working there without making the app package ESM. (Verified in a prior run.)
- **No electron-updater** anywhere — not in deps, not in `main`, not as a `publish` block in electron-builder.yml.
- **Package versions (verbatim):** `electron@^43.0.0`, `electron-vite@^5.0.0`, `electron-builder@^25.1.8`, `@electron-toolkit/utils@^4.0.0`, `@electron-toolkit/preload@^3.0.2`, `@electron-toolkit/tsconfig@^2.0.0`, `@playwright/test@^1.48.0`, `vite@^7.3.6` (electron-vite@5 peers on vite 6/7; Plexus proves the Mural plugin works on vite 7).
- **App identity (verbatim):** appId `com.pragmatic-tech-ai.todl`, productName `TODL`.
- **Tests** live in a `tests/` subfolder (repo convention). **Commits** on branch `feat/app-electron`, staging only each task's files; never `git push`.

---

### Task 1: package.json — toolchain, scripts, canonical main

**Files:** Modify `app/package.json`

**Interfaces:** Produces `"main": "./out/main/index.js"` + scripts consumed by later tasks. No electron-updater.

- [ ] **Step 1: Rewrite `app/package.json`** (note: NO `"type"` field, NO electron-updater):

```json
{
  "name": "todl-demo-app",
  "private": true,
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
    "vite": "^7.3.6"
  }
}
```

- [ ] **Step 2:** `npm --prefix app install` (Electron already on disk from a prior run; this reconciles the lock). Expect success.
- [ ] **Step 3: Verify** — `npm --prefix app ls electron electron-vite electron-builder --depth=0` lists majors 43 / 5 / 25.
- [ ] **Step 4: Commit** — `git add app/package.json app/package-lock.json && git commit -m "build(app): add electron toolchain (canonical layout, no auto-update)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 2: Canonical restructure — relocate renderer, add main/preload, config, aliases

The meaty task: move the renderer under `src/renderer/`, add `src/main` + `src/preload`, write the default-root electron-vite config with the ported renderer settings + `@shared`/`@examples` aliases, convert the 19 cross-root imports to those aliases, and build.

**Files:**
- Move (git mv): `app/index.html` → `app/src/renderer/index.html`; each of `app/src/{app-vm.ts, shell.mu, main.ts, opentype-shim.mjs, editor, pages, components, ui-verify}` → `app/src/renderer/src/`
- Create: `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/electron.vite.config.ts`, `app/tsconfig.node.json`, `app/tsconfig.web.json`, `app/tsconfig.json`
- Delete: `app/vite.config.ts`
- Modify: the ~11 renderer files whose imports reference repo `shared/`/`examples/` (specifier rewrite only)

**Interfaces:** Consumes `"main"` from Task 1. Produces `app/out/{main/index.js, preload/index.js, renderer/index.html}`, and a global `window.todl` (empty) for SP2.

- [ ] **Step 1: Relocate the renderer** (use `git mv` to preserve history):

```bash
cd app
mkdir -p src/renderer/src
git mv index.html src/renderer/index.html
for p in app-vm.ts shell.mu main.ts opentype-shim.mjs editor pages components ui-verify; do git mv "src/$p" "src/renderer/src/$p"; done
```

- [ ] **Step 2: Convert the cross-root imports to aliases.** In every `.ts` file under `app/src/renderer/src/`, rewrite import specifiers that reach the repo root:
  - any specifier matching `(../)+shared/`  → `@shared/`   (e.g. `"../../../../shared/verify.js"` → `"@shared/verify.js"`, `"../../shared/corpus-types.js"` → `"@shared/corpus-types.js"`)
  - any specifier matching `(../)+examples/` → `@examples/` (e.g. `"../../../../examples/corpus.generated.js"` → `"@examples/corpus.generated.js"`)
  - **Do not touch** any other relative import (internal `../editor/…`, `./pages/…`, etc. stay as-is).

  The affected files (19 imports) are: `app-vm.ts`; `components/example-runner/{diagnostic-vm,example-runner-vm,graph-view}.ts`; `pages/docs/{docs-section-vm,docs-vm}.ts`; `pages/gallery/{gallery-card-vm,gallery-vm}.ts`; `pages/playground/{example-ref-vm,permalink-sync,playground-vm}.ts` (all now under `app/src/renderer/src/`). Verify none remain: `grep -rnE "(\.\./)+(shared|examples)/" app/src/renderer/src` returns nothing.

- [ ] **Step 3: Create `app/src/main/index.ts`** (CJS main, no auto-update):

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";

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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 4: Create `app/src/preload/index.ts`** (empty bridge for SP1):

```ts
import { contextBridge } from "electron";

// SP1: expose an empty namespace so contextIsolation is wired end-to-end.
// SP2 populates `todl.registry` / `todl.config`.
contextBridge.exposeInMainWorld("todl", {});
```

- [ ] **Step 5: Create `app/electron.vite.config.ts`** (DEFAULT roots — electron-vite auto-finds `src/main`, `src/preload`, `src/renderer/index.html`):

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const rendererSrc = resolve(here, "src/renderer/src");

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [vitePluginMural()],
    // Mural resolves themes/DataTemplates by runtime Class.name — do not rename.
    esbuild: { keepNames: true },
    build: { target: "esnext" }, // top-level await in the renderer bootstrap
    resolve: {
      alias: [
        { find: /^@shared\//, replacement: `${resolve(repoRoot, "shared")}/` },
        { find: /^@examples\//, replacement: `${resolve(repoRoot, "examples")}/` },
        { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(repoRoot, "dist/language-server/index.js") },
        { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(repoRoot, "dist/language-service/index.js") },
        { find: /^@pragmatic-tech-ai\/todl$/, replacement: resolve(repoRoot, "dist/index.js") },
        { find: /^opentype\.js$/, replacement: resolve(rendererSrc, "opentype-shim.mjs") },
      ],
    },
    server: { fs: { allow: [repoRoot, resolve(repoRoot, "..", "Mural")] } },
  },
});
```

- [ ] **Step 6: Create the tsconfigs.**

`app/tsconfig.node.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*"],
  "compilerOptions": { "composite": true, "types": ["electron-vite/node", "node"] }
}
```

`app/tsconfig.web.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": ["src/renderer/src/**/*"],
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"],
      "@examples/*": ["../examples/*"],
      "@pragmatic-tech-ai/todl": ["../dist/index.js"]
    }
  }
}
```

`app/tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

- [ ] **Step 7: Delete the old config** — `git rm app/vite.config.ts`

- [ ] **Step 8: Build** — `npm run build && npm --prefix app run build`. Then verify: `ls app/out/main/index.js app/out/preload/index.js app/out/renderer/index.html` (all print). If the renderer build fails on a missing `@shared`/`@examples` import, an import specifier was missed in Step 2 — fix it; if it fails on the Mural plugin under vite 7, STOP and report BLOCKED with the exact error (fallback electron-vite@^4 + vite@^5, but escalate — do not apply unilaterally).

- [ ] **Step 9: Commit** — stage the moves, new files, deletions, and edits:
```bash
git add app/src app/electron.vite.config.ts app/tsconfig.node.json app/tsconfig.web.json app/tsconfig.json
git rm app/vite.config.ts
git add -A app/src   # ensure renames + import edits are staged
git commit -m "feat(app): canonical electron-vite layout (src/{main,preload,renderer}) + @shared/@examples aliases" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Launch smoke (Playwright _electron)

Prove the canonical build launches and Mural renders (an `<svg>` under `#app`).

**Files:** Create `app/playwright.config.ts`, `app/tests/smoke/launch.spec.ts`, `app/tests/package.json`

- [ ] **Step 1: `app/tests/package.json`** (ESM marker so Playwright keeps `import.meta` working in this subtree — required, learned in a prior run):
```json
{ "type": "module" }
```

- [ ] **Step 2: `app/playwright.config.ts`:**
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "tests", timeout: 60_000, fullyParallel: false, workers: 1 });
```

- [ ] **Step 3: `app/tests/smoke/launch.spec.ts`:**
```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("app launches in a window and the renderer mounts", async () => {
  // Strip ELECTRON_RUN_AS_NODE: launched from a Node/tsx context it makes
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

- [ ] **Step 4: RED** — `rm -rf app/out && npm --prefix app run test:e2e` → FAIL (test times out; no `out/main/index.js`). Capture as RED evidence.
- [ ] **Step 5: GREEN** — `npm run build && npm --prefix app run build && npm --prefix app run test:e2e` → PASS. Capture as GREEN evidence. Do not weaken the `#app svg` assertion to force a pass; if the app genuinely doesn't render, report BLOCKED.
- [ ] **Step 6: Commit** — `git add app/playwright.config.ts app/tests && git commit -m "test(app): electron launch smoke (playwright _electron)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 4: electron-builder packaging (no publish/auto-update)

**Files:** Create `app/electron-builder.yml`, `app/.gitignore`

- [ ] **Step 1: `app/electron-builder.yml`** (NO `publish` block — no releases/auto-update for a demo app):
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
  artifactName: ${productName}-${version}-${arch}.${ext}
```

- [ ] **Step 2: `app/.gitignore`:**
```
out/
release/
dist/
test-results/
```

- [ ] **Step 3: Verify** — `npm run build && npm --prefix app run build && npx --prefix app electron-builder --dir` produces `app/release/<platform>-unpacked/` with the TODL executable (Windows: `app/release/win-unpacked/TODL.exe`).
- [ ] **Step 4: Commit** — `git add app/electron-builder.yml app/.gitignore && git commit -m "build(app): electron-builder packaging config" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 5: Remove the GitHub Pages deployment

**Files:** Delete `.github/workflows/deploy.yml`; modify root `package.json`

- [ ] **Step 1:** `git rm .github/workflows/deploy.yml` (`ci.yml` builds/tests the todl core — leave it).
- [ ] **Step 2:** In root `package.json` `scripts`, remove `app:build:pages` and repoint the delegators:
```json
    "app:build": "npm run build && npm --prefix app run build",
    "app:dev": "npm run build && npm --prefix app run dev",
    "app:verify": "node app/src/renderer/src/ui-verify/render-check.mjs",
```
(`app:verify` path updated for the relocated `ui-verify/`.)
- [ ] **Step 3: Verify** — `grep -rn "pages\|deploy-pages\|upload-pages\|app:build:pages" .github package.json app/package.json` returns nothing.
- [ ] **Step 4: Commit** — `git add package.json && git rm .github/workflows/deploy.yml && git commit -m "build: drop GitHub Pages deploy (app is Electron-only)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Self-Review

**1. Spec coverage (SP1 §4, canonical):** canonical `src/{main,preload,renderer}` → Tasks 1-2 ✓ · main/preload/config → Task 2 ✓ · renderer config ported (Mural plugin, todl aliases, opentype shim, keepNames, fs.allow) → Task 2 Step 5 ✓ · electron-builder mirroring Plexus (minus publish per U1) → Task 4 ✓ · auto-update removed (U1) → absent everywhere ✓ · drop Pages + `app:build:pages` → Task 5 ✓ · done-when launch smoke → Task 3 ✓.

**2. Placeholder scan:** every file has full content; the only omission (electron-builder `publish`) is intentional per U1.

**3. Type/name consistency:** `window.todl` empty in preload, extended in SP2 · `@shared`/`@examples` aliases defined in `electron.vite.config.ts` (vite) AND `tsconfig.web.json` (paths) · `out/{main,preload,renderer}` paths consistent across Tasks 2-4 · `app:verify` path (Task 5) matches the relocated `src/renderer/src/ui-verify/` (Task 2) · main uses `__dirname` (CJS, per Global Constraints — no `type:module`).
