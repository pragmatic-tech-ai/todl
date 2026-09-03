# TODL Package Manager — Design

**Status:** In progress (brainstorming output). Foundation and architecture
decided; sub-project detail (SP1–SP4) to be modeled. Nothing implemented yet.

**Date:** 2026-09-03

**Related:** [TODL Runtime Surface](2026-09-03-todl-runtime-surface-design.md) —
the PM's resolve/load adapter feeds that surface's `ComposeGraph`.

---

## 1. Motivation

TODL already has the *artifact* half of a package system:

- `compilePackage` → a `CompiledPackage` (own-only `model.json` + recorded
  `dependencies` as pinned `PackageRef`s + `sources` + derived `classes`).
- `publish` → persists through a `PackageStore` (`BlobPackageStore`,
  `GraphPackageStore`).
- `PackageKind` (meta-model / library), `PackageIdentity` (id + version),
  `PackageRef` (kind + id + **exact** version).

What is missing is the *manager* half — nothing resolves a package's recorded
dependencies into an ordered, deduped closure of artifacts, and there is no
publish/install/version/CLI story. `publish.ts` even says "consumers reassemble
the closure by resolving those dependencies transitively," but that resolver does
not exist. This spec builds the manager half.

---

## 2. Decisions (pinned)

- **Full lifecycle**, but by **wrapping npm / GitHub Packages** rather than
  building a native registry/solver. npm owns registry, auth, semver, version
  selection, `package-lock.json`, cache, transport/CDN, and the `install` command.
- **A published TODL package *is* an npm package.** TODL writes two adapters plus
  glue; npm does the heavy lifting.
- **`project.plexus` is the authored manifest; `package.json` is generated** at
  pack time from it. `package.json` is a build artifact, not hand-edited.
- **npm scope is parametrised.** Default `@pragmatic-tech-ai`, but the scope is a
  configuration value (Plexus may change it), so nothing hard-codes it and
  resolution does not depend on it (see §4).
- **Dependency versions are exact pins** (`"0.1.0"`), matching today's
  `PackageRef` and `project.plexus`.
- **Only meta-models and libraries are published.** The **application** is *not* a
  published package — it will be handled by a separate **build system** (future,
  its own spec). The PM's resolve/load adapter is still used to compose an app's
  installed dependencies.

---

## 3. Architecture

```
                     project.plexus (authored)
                              │  pack
                              ▼
      ┌──────────── TODL package = npm package ────────────┐
      │  package.json (generated)  ·  model.json  ·  src/   │
      │  index.js (toMetaModule handle) · index.d.ts (types)│
      └─────────────────────────────────────────────────────┘
                              │  npm publish
                              ▼
                 GitHub Packages  ◀── registry/auth/semver/CDN (npm)
                              │  npm install  (→ node_modules + lock)
                              ▼
                    installed dependency tree
                              │  TODL resolve/load adapter
                              ▼
        ordered, deduped meta-models[] + libraries[]  →  ComposeGraph
```

**npm owns:** registry (GitHub Packages), auth, semver ranges, version selection,
lockfile, cache, transport/CDN, and `install` (transitive closure).

**TODL owns (the PM's real code):**

1. **Pack/publish adapter** — `compilePackage` → write the npm layout → hand off
   to `npm publish`. Extends `BlobPackageStore` to also emit `package.json` + the
   JS entry.
2. **Resolve/load adapter** — from an installed tree (Node: `node_modules`;
   browser: bundled imports), discover TODL packages, read each `model.json`,
   order by kind + dependency graph, dedup, and produce the `metaModels[]` +
   `libraries[]` that `ComposeGraph` consumes. The closure is whatever npm already
   installed.
3. **CLI glue** — `todl pack` / `todl publish`; `todl install` largely delegates
   to `npm install`.

---

## 4. Package format

A TODL package is an npm package with this payload:

| File | Source | Purpose |
|---|---|---|
| `package.json` | generated from `project.plexus` | npm identity + deps + a `todl` block |
| `model.json` | `compilePackage` (`PackageDocument`: own nodes + deps) | the compiled artifact |
| `src/` | `CompiledPackage.sources` | round-trippable `.todl` |
| `index.js` | `toMetaModule` | the ES-module **package handle** wrapping the embedded `model.json` (hybrid-C embedding) |
| `index.d.ts` + typed classes | `generateReadClient` | the typed layer (`typeof(Class)` bridge) |

### `project.plexus` → `package.json` mapping

Grounded in `test_projects/libraries/microsoft/project.plexus`:

```json
// project.plexus (authored)              // package.json (generated; <scope> is config)
{ "type": "library",                      {
  "id": "microsoft",                        "name": "<scope>/microsoft",
  "libVersion": "0.1.0",                    "version": "0.1.0",
  "metaModel": {                            "dependencies": {
    "id": "tech-architecture",               "<scope>/tech-architecture": "0.1.0"
    "version": "0.1.0" } }                  },
                                            "todl": { "kind": "library", "id": "microsoft" },
                                            "main": "index.js",
                                            "files": ["model.json","src","index.js","index.d.ts"] }
```

Rules:
- `type` → `todl.kind` (`meta-model` | `library`).
- `modelVersion` / `libVersion` → npm `version`.
- `metaModel` + `libraries[]` → npm `dependencies`, each pinned exactly.
- `id` → the package name's local part, prefixed with the configured `<scope>`.

### Recognition does not depend on scope

Because the scope is configurable, the resolve adapter identifies a TODL package
by the presence of the **`todl` block** in its `package.json` (carrying `kind` +
`id`), *not* by the npm scope. Changing the scope never breaks resolution.

---

## 5. Decomposition (dependency-ordered)

- **SP1 — Package format.** The generated `package.json` shape, the `project.plexus`
  → `package.json` transform, the `todl` metadata block, and the payload
  (`model.json` + `src` + `index.js` handle + typed classes). Scope is injected as
  config.
- **SP2 — Pack/publish adapter.** `compilePackage` → write the npm layout to a
  directory (extending `BlobPackageStore`) → `npm publish`. GitHub Packages auth
  (existing `PACKAGES_TOKEN` story) is reused.
- **SP3 — Resolve/load adapter.** Installed tree → discover TODL packages (via the
  `todl` block) → read `model.json`s → order (meta-model before library, deps
  before dependents) + dedup (first-wins, as `mergeBases`) → feed `ComposeGraph`.
  Node (`node_modules`) and browser (bundled imports) hosts.
- **SP4 — CLI glue.** `todl pack` / `todl publish`; `todl install` ≈ `npm install`;
  `todl list` / status. Thin over SP1–SP3 + npm.

---

## 6. Integration

- **Runtime surface** — SP3's output *is* `ComposeGraph([metaModels], [libraries])`.
  A package handle (§4 `index.js`) is exactly what the runtime spec's §4 expects.
- **Future build system (apps)** — the application (`test_architecture`) is not
  published. It declares its deps in `project.plexus`, `npm install`s them, and the
  build system uses SP3's resolve/load adapter to compose them. The build system is
  a separate subsystem/spec; the PM only provides the resolve/load capability it
  consumes.

---

## 7. Mapping to existing code

| Need | Existing |
|---|---|
| Compile to an artifact | `compilePackage`, `PackageDocument`, `PackageRef`, `deriveClasses` |
| Write package layout | `BlobPackageStore` (extend to emit `package.json` + entry) |
| ES-module handle | `toMetaModule` (`emit/js-module`) |
| Typed classes | `generateReadClient` (`codegen`) |
| Compose closure | `mergeBases` / `checkAgainst`; runtime `ComposeGraph` |
| Auth/registry | GitHub Packages + `PACKAGES_TOKEN` (existing Plexus installer work) |

---

## 8. Open / Next

1. **Browser resolution detail** — how the bundled-import path (hybrid-C) discovers
   TODL packages when there is no `node_modules` (build-time bundling + the `todl`
   block, or an import-map/manifest).
2. **Scope configuration mechanism** — where the `<scope>` value is read from
   (env, a `todl` config, the workspace) for pack and CLI.
3. **Lockfile** — whether TODL records its own resolved closure or trusts
   `package-lock.json` entirely (leaning: trust npm's lock; TODL re-derives order
   from the `todl` blocks).
4. **CLI surface** — exact commands and their npm delegation.
5. **Transitive ordering** — precise topological order across meta-model + library
   deps, and dedup rules when versions collide (exact pins should make collisions
   an error, not a silent pick).
6. **The application build system** — its own spec; consumes SP3.

---

## Appendix — Worked example (`test_projects`)

Four projects, already validated (0 errors) and loadable via the runtime surface:

- `meta-models/tech-architecture` → `<scope>/tech-architecture@0.1.0` (kind
  `meta-model`, no deps).
- `libraries/microsoft` → `<scope>/microsoft@0.1.0` (kind `library`, dep
  `tech-architecture@0.1.0`).
- `libraries/aws` → `<scope>/aws@0.1.0` (kind `library`, dep
  `tech-architecture@0.1.0`).
- `architectures/test_architecture` → **not published**; declares deps on
  `tech-architecture`, `microsoft`, `aws`; the future build system installs +
  composes them via SP3.

`npm install` of the app would fetch the three published packages; SP3 orders them
(`tech-architecture` before the libraries), dedups the shared meta-model
(first-wins), and hands `ComposeGraph` its `[tech-architecture]` +
`[microsoft, aws]`.
