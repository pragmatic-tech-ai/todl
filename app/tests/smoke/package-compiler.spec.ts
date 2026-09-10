import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// Fake bridge: a directory picker, a successful compile, and a publish that
// records the directory it received. Publish confirmation is a Mural in-app
// dialog (not a bridge call), so the fake needs no confirm hook. `window.todl`
// is frozen by contextBridge, so RegistryClient reads the mutable
// `__todlBridge` override first.
function installFakeBridge(window: Page): Promise<void> {
  return window.evaluate(() => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      dialog: { pickDirectory: () => Promise.resolve("C:/proj/demo") },
      fs: { readDir: () => Promise.resolve([
        { name: "src", path: "C:/proj/demo/src", isDirectory: true },
        { name: "landscape.todl", path: "C:/proj/demo/landscape.todl", isDirectory: false },
      ]) },
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

// Open the compiler ToolBar's overflow (chevron) popup. The command buttons live
// in a ToolBar in the side pane; in the 300px pane the rarer conflict-recovery
// buttons overflow into the chevron popup, which mounts only when opened. The
// chevron carries no text, so locate it via the ToolBar's PART_Chevron and click
// its centre (the established mural-visual-backref introspection path).
async function openToolbarOverflow(window: Page): Promise<void> {
  const center = await window.evaluate(() => {
    const REF = Symbol.for("mural:visual-backref");
    let toolbar: { visualChildren?: { FindName(n: string): unknown }[] } | undefined;
    for (const el of Array.from(document.querySelectorAll("#app *"))) {
      const v = (el as unknown as Record<symbol, { constructor: { name: string } }>)[REF];
      if (v?.constructor?.name === "ToolBar") { toolbar = v as never; break; }
    }
    const chevron = toolbar?.visualChildren?.[0]?.FindName("PART_Chevron");
    if (chevron === undefined || chevron === null) return null;
    for (const el of Array.from(document.querySelectorAll("#app *"))) {
      if ((el as unknown as Record<symbol, unknown>)[REF] === chevron) {
        const r = (el as Element).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  if (center === null) throw new Error("toolbar overflow chevron not found");
  await window.mouse.click(center.x, center.y);
}

function allText(window: Page): Promise<string> {
  return window.evaluate(() =>
    Array.from(document.querySelectorAll("#app text, #app tspan"))
      .map((n) => n.textContent ?? "")
      .join(" "),
  );
}

// Click a Mural dialog action button by label. The publish confirm is a modal
// Mural dialog, vertically centred over the shell, so its action row sits well
// below the side-pane toolbar/status. A confirm label like "Publish" also exists
// on the toolbar (behind the scrim), so pick the LOWEST (max-y) exact-label text
// to target the dialog action. Coordinate click lands on the button's `mural-hit`
// rect (which would otherwise intercept an actionability click).
async function clickDialogButton(window: Page, label: string): Promise<void> {
  const box = await window.evaluate((wanted) => {
    let best: { x: number; y: number; w: number; h: number } | null = null;
    for (const t of Array.from(document.querySelectorAll("text, tspan"))) {
      if ((t.textContent ?? "").trim() !== wanted) continue;
      const r = (t as Element).getBoundingClientRect();
      if (best === null || r.y > best.y) best = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return best;
  }, label);
  if (box === null) throw new Error(`dialog button "${label}" not found`);
  await window.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
}

test("Compiler capability: open → compile → view → publish (with confirm)", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeBridge(window);
  await clickRailCapability(window, 2); // Home=0, Packages=1, Compiler=2

  // Open a directory → its contents show as a tree in the side panel.
  await window.getByText("Open", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("landscape.todl"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("src"), { timeout: 10_000 }).toBe(true);

  // Compile → the central content host shows the CompiledPackage.
  await window.getByText("Compile", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("@scope/demo@0.1.0"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("src/main.todl"), { timeout: 10_000 }).toBe(true);

  // Publish (outward-facing) opens a modal Mural confirm dialog; confirming it
  // (the overlay "Publish" action) publishes.
  await window.getByText("Publish", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("to the registry?"), { timeout: 10_000 }).toBe(true);
  await clickDialogButton(window, "Publish");
  await expect.poll(async () => (await allText(window)).includes("Published."), { timeout: 10_000 }).toBe(true);

  const published = await window.evaluate(() => (window as unknown as { __published?: string }).__published);
  expect(published).toBe("C:/proj/demo/dist");

  await app.close();
});

test("Compiler capability: declining the publish confirm dialog does not publish", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  // Same as the happy-path bridge, but the publish records whether it was ever
  // invoked (the confirm dialog will be declined via its Cancel action).
  await window.evaluate(() => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      dialog: { pickDirectory: () => Promise.resolve("C:/proj/demo") },
      fs: { readDir: () => Promise.resolve([
        { name: "src", path: "C:/proj/demo/src", isDirectory: true },
        { name: "landscape.todl", path: "C:/proj/demo/landscape.todl", isDirectory: false },
      ]) },
      registry: {
        compileDir: (dir: string) =>
          Promise.resolve({ ok: true, outDir: dir + "/dist", files: ["package.json"], diagnostics: [], name: "@scope/demo", version: "0.1.0", sourceCount: 1 }),
        publishDir: () => { (window as unknown as { __published: boolean }).__published = true; return Promise.resolve(); },
      },
    };
  });
  await clickRailCapability(window, 2);

  await window.getByText("Open", { exact: true }).first().click();
  await window.getByText("Compile", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("@scope/demo@0.1.0"), { timeout: 10_000 }).toBe(true);

  // Publish → decline the confirm dialog (Cancel) → nothing is published.
  await window.getByText("Publish", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("to the registry?"), { timeout: 10_000 }).toBe(true);
  await clickDialogButton(window, "Cancel");
  await expect.poll(async () => (await allText(window)).includes("Publish canceled."), { timeout: 10_000 }).toBe(true);
  const published = await window.evaluate(() => (window as unknown as { __published?: boolean }).__published);
  expect(published).toBe(undefined);

  await app.close();
});

// A publish that first hits a 409 "existing version" conflict, offering the user
// a choice; clicking "Bump version" bumps, recompiles, republishes.
function installConflictBridge(window: Page): Promise<void> {
  return window.evaluate(() => {
    let publishCount = 0;
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      dialog: { pickDirectory: () => Promise.resolve("C:/proj/demo") },
      fs: { readDir: () => Promise.resolve([
        { name: "src", path: "C:/proj/demo/src", isDirectory: true },
        { name: "landscape.todl", path: "C:/proj/demo/landscape.todl", isDirectory: false },
      ]) },
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

  await window.getByText("Open", { exact: true }).first().click();
  await window.getByText("Compile", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("@scope/demo@0.1.0"), { timeout: 10_000 }).toBe(true);

  // Publish → confirm the dialog → the first attempt 409s and the choice appears.
  await window.getByText("Publish", { exact: true }).first().click();
  await expect.poll(async () => (await allText(window)).includes("to the registry?"), { timeout: 10_000 }).toBe(true);
  await clickDialogButton(window, "Publish");
  await expect.poll(async () => (await allText(window)).includes("already published"), { timeout: 10_000 }).toBe(true);
  // The two conflict-recovery buttons overflow into the ToolBar's chevron popup —
  // open it, then they become reachable.
  await openToolbarOverflow(window);
  await expect.poll(async () => (await window.getByText("Bump version", { exact: true }).count()) > 0, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await window.getByText("Delete version", { exact: true }).count()) > 0, { timeout: 10_000 }).toBe(true);

  // Choose bump → bumps, recompiles, republishes successfully. Click by
  // coordinate: the popup item layers a `mural-hit` rect over the label that
  // intercepts Playwright's actionability click, but a mouse click at the label
  // centre lands on that hit rect and fires the command.
  const bumpBox = await window.getByText("Bump version", { exact: true }).first().boundingBox();
  if (bumpBox === null) throw new Error("Bump version button not found");
  await window.mouse.click(bumpBox.x + bumpBox.width / 2, bumpBox.y + bumpBox.height / 2);
  await expect.poll(async () => (await allText(window)).includes("Published."), { timeout: 10_000 }).toBe(true);
  const bumped = await window.evaluate(() => (window as unknown as { __bumped?: boolean }).__bumped);
  expect(bumped).toBe(true);

  await app.close();
});
