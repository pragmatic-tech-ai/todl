import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// An in-memory `fs:*` bridge + a fixed directory picker, installed as the mutable
// `__todlBridge` override (contextBridge freezes `window.todl`). Paths arriving
// here are absolute (the renderer's AppLocalStorage joins root + relative). The
// store can be pre-seeded so an Open flow finds an existing solution.
function installFakeBridge(window: Page, seed: Record<string, string>, pickDir: string): Promise<void> {
  return window.evaluate(
    ({ seed, pickDir }) => {
      const files = new Map<string, string>(Object.entries(seed));
      const dirs = new Set<string>();
      const has = (p: string): boolean => {
        if (files.has(p) || dirs.has(p)) return true;
        const prefix = p.endsWith("/") ? p : p + "/";
        for (const f of files.keys()) if (f.startsWith(prefix)) return true;
        return false;
      };
      (window as unknown as { __fsFiles: Map<string, string> }).__fsFiles = files;
      (window as unknown as { __todlBridge: unknown }).__todlBridge = {
        dialog: { pickDirectory: () => Promise.resolve(pickDir) },
        fs: {
          readText: (p: string) => {
            const v = files.get(p);
            return v === undefined ? Promise.reject(new Error("ENOENT " + p)) : Promise.resolve(v);
          },
          writeText: (p: string, c: string) => { files.set(p, c); return Promise.resolve(); },
          readBytes: (p: string) => Promise.resolve(new TextEncoder().encode(files.get(p) ?? "")),
          writeBytes: (p: string, b: Uint8Array) => { files.set(p, new TextDecoder().decode(b)); return Promise.resolve(); },
          exists: (p: string) => Promise.resolve(has(p)),
          delete: (p: string) => { files.delete(p); dirs.delete(p); return Promise.resolve(); },
          mkdir: (p: string) => { dirs.add(p); return Promise.resolve(); },
          rename: () => Promise.resolve(),
          list: (p: string) => {
            const prefix = p.endsWith("/") ? p : p + "/";
            const out: { name: string; path: string; isDirectory: boolean }[] = [];
            for (const f of files.keys()) {
              if (f.startsWith(prefix)) {
                const rest = f.slice(prefix.length);
                if (!rest.includes("/")) out.push({ name: rest, path: f, isDirectory: false });
              }
            }
            return Promise.resolve(out);
          },
          openExternal: () => Promise.resolve(),
        },
      };
    },
    { seed, pickDir },
  );
}

async function clickRailCapability(window: Page, index: number): Promise<void> {
  const cells = await window.evaluate(() => {
    const byY = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const el of Array.from(document.querySelectorAll("#app rect"))) {
      const r = (el as Element).getBoundingClientRect();
      if (r.left < 4 && Math.round(r.width) === 48 && Math.round(r.height) === 48) {
        byY.set(Math.round(r.y), { x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return Array.from(byY.values()).sort((a, b) => a.y - b.y);
  });
  const c = cells[index];
  await window.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
}

function allText(window: Page): Promise<string> {
  return window.evaluate(() =>
    Array.from(document.querySelectorAll("#app text, #app tspan"))
      .map((n) => n.textContent ?? "")
      .join(" "),
  );
}

// Rail order (app.mu .modules): Home=0, Packages=1, Compiler=2, Solutions=3.
const SOLUTIONS_RAIL = 3;

test("Solutions capability: New → settings pane renders → Save writes solution.json", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeBridge(window, {}, "/work/sol");
  await clickRailCapability(window, SOLUTIONS_RAIL);

  // New → an empty solution becomes active; its title + the npm-registry setting
  // bag's fields appear in the side-pane PropertyGrid.
  await window.getByText("New", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("Untitled Solution"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("Registry URL"), { timeout: 10_000 }).toBe(true);

  // Save → the manifest is written to solution.json in the picked folder.
  await window.getByText("Save", { exact: true }).first().click();
  await expect
    .poll(
      async () =>
        window.evaluate(() => {
          const files = (window as unknown as { __fsFiles: Map<string, string> }).__fsFiles;
          return files.get("/work/sol/solution.json") ?? "";
        }),
      { timeout: 10_000 },
    )
    .toContain("todl-solution");

  await app.close();
});

test("Home welcome is the startup landing; New Solution navigates to the Solutions view", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  // Startup lands on Home — now a welcome page, not the empty scaffold placeholder.
  await expect.poll(async () => (await allText(window)).includes("Welcome to TODL"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("New Solution"), { timeout: 10_000 }).toBe(true);

  // Clicking New Solution creates one AND switches to the Solutions capability,
  // so its settings pane (npm-registry fields) is now visible.
  await installFakeBridge(window, {}, "/work/sol");
  await window.getByText("New Solution", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("Untitled Solution"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("Registry URL"), { timeout: 10_000 }).toBe(true);

  await app.close();
});

test("Solutions capability: Open a solution with a todl-package member shows the member row", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  // Pre-seed a solution folder: a manifest naming one ./api member (type
  // todl-package) + that member's project.plexus manifest.
  const solutionJson = JSON.stringify({
    kind: "todl-solution",
    version: 1,
    name: "Seeded Solution",
    members: [{ path: "./api", type: "todl-package" }],
    settings: {},
  });
  const projectPlexus = JSON.stringify({ type: "todl-package", name: "API", version: 1 });
  await installFakeBridge(
    window,
    { "/work/sol/solution.json": solutionJson, "/work/sol/api/project.plexus": projectPlexus },
    "/work/sol",
  );
  await clickRailCapability(window, SOLUTIONS_RAIL);

  await window.getByText("Open", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("Seeded Solution"), { timeout: 10_000 }).toBe(true);
  // The member row (its relative path "api", normalized from "./api") appears in
  // the Solution Explorer tree.
  await expect.poll(async () => (await allText(window)).includes("api"), { timeout: 10_000 }).toBe(true);

  await app.close();
});
