import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// Fake bridge: a directory picker, a successful compile, and a publish that
// records the directory it received. `window.todl` is frozen by contextBridge,
// so RegistryClient reads the mutable `__todlBridge` override first.
function installFakeBridge(window: Page): Promise<void> {
  return window.evaluate(() => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      dialog: { pickDirectory: () => Promise.resolve("C:/proj/demo") },
      registry: {
        compileDir: (dir: string) =>
          Promise.resolve({
            ok: true,
            outDir: dir + "/dist",
            files: ["package.json", "model.json", "src/main.todl"],
            diagnostics: [],
            name: "@scope/demo",
            version: "0.1.0",
            sourceCount: 1,
          }),
        publishDir: (dir: string) => {
          (window as unknown as { __published: string }).__published = dir;
          return Promise.resolve();
        },
      },
    };
  });
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

// Coordinate click on an SVG text with exact content (Playwright's actionability
// check times out clicking SVG <text> directly, so click its centre point).
async function clickText(window: Page, label: string): Promise<void> {
  const box = await window.evaluate((t) => {
    for (const el of Array.from(document.querySelectorAll("#app text, #app tspan"))) {
      if ((el.textContent ?? "").trim() === t) {
        const r = (el as Element).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, label);
  if (box === null) throw new Error(`text "${label}" not found`);
  await window.mouse.click(box.x, box.y);
}

function allText(window: Page): Promise<string> {
  return window.evaluate(() =>
    Array.from(document.querySelectorAll("#app text, #app tspan"))
      .map((n) => n.textContent ?? "")
      .join(" "),
  );
}

test("Compiler capability: open → compile → view → publish (with confirm)", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeBridge(window);
  await clickRailCapability(window, 2); // Home=0, Packages=1, Compiler=2

  // Open a directory (action row) → the picked path shows in the side panel.
  await clickText(window, "Open Directory");
  await expect.poll(async () => (await allText(window)).includes("C:/proj/demo"), { timeout: 10_000 }).toBe(true);

  // Compile → the central content host shows the CompiledPackage.
  await clickText(window, "Compile");
  await expect.poll(async () => (await allText(window)).includes("@scope/demo@0.1.0"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("src/main.todl"), { timeout: 10_000 }).toBe(true);

  // Publish arms a confirm (outward-facing); a second selection publishes.
  await clickText(window, "Publish");
  await expect.poll(async () => (await allText(window)).includes("again to confirm"), { timeout: 10_000 }).toBe(true);
  await clickText(window, "Publish");
  await expect.poll(async () => (await allText(window)).includes("Published."), { timeout: 10_000 }).toBe(true);

  const published = await window.evaluate(() => (window as unknown as { __published?: string }).__published);
  expect(published).toBe("C:/proj/demo/dist");

  await app.close();
});

// A publish that first hits a 409 "existing version" conflict, offering the user
// a choice; selecting "Bump version & republish" bumps, recompiles, republishes.
function installConflictBridge(window: Page): Promise<void> {
  return window.evaluate(() => {
    let publishCount = 0;
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      dialog: { pickDirectory: () => Promise.resolve("C:/proj/demo") },
      registry: {
        compileDir: (dir: string) =>
          Promise.resolve({ ok: true, outDir: dir + "/dist", files: ["package.json"], diagnostics: [], name: "@scope/demo", version: "0.1.0", sourceCount: 1 }),
        publishDir: (dir: string) => {
          publishCount += 1;
          if (publishCount === 1) {
            return Promise.reject(new Error('publish @scope/demo@0.1.0 failed: HTTP 409 {"error":"Cannot publish over existing version"}'));
          }
          (window as unknown as { __published: string }).__published = dir;
          return Promise.resolve();
        },
        bumpVersion: () => { (window as unknown as { __bumped: boolean }).__bumped = true; return Promise.resolve("0.1.1"); },
        deleteVersion: () => Promise.resolve(),
      },
    };
  });
}

test("Compiler capability: 409 conflict offers a choice; Bump version & republish recovers", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installConflictBridge(window);
  await clickRailCapability(window, 2);

  await clickText(window, "Open Directory");
  await clickText(window, "Compile");
  await expect.poll(async () => (await allText(window)).includes("@scope/demo@0.1.0"), { timeout: 10_000 }).toBe(true);

  // Publish (arm + confirm) → the first attempt 409s and the choice appears.
  await clickText(window, "Publish");
  await clickText(window, "Publish");
  await expect.poll(async () => (await allText(window)).includes("already published"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("Bump version & republish"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("Delete published version & republish"), { timeout: 10_000 }).toBe(true);

  // Choose bump → bumps, recompiles, republishes successfully.
  await clickText(window, "Bump version & republish");
  await expect.poll(async () => (await allText(window)).includes("Published."), { timeout: 10_000 }).toBe(true);
  const bumped = await window.evaluate(() => (window as unknown as { __bumped?: boolean }).__bumped);
  expect(bumped).toBe(true);

  await app.close();
});
