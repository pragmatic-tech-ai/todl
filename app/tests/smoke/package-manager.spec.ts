import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// The registry package names the fake bridge returns; mutated to prove Refresh
// re-fetches. `window.todl` is frozen by contextBridge, so RegistryClient reads
// the mutable `__todlBridge` override first (the production injection seam).
// getPackageContents backs the per-package content tree (one fetch per expand).
function installFakeRegistry(window: Page): Promise<void> {
  return window.evaluate(() => {
    (window as unknown as { __pkgNames: string[] }).__pkgNames = ["aws", "azure"];
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      registry: {
        list: () =>
          Promise.resolve((window as unknown as { __pkgNames: string[] }).__pkgNames),
        getPackageContents: (name: string) =>
          Promise.resolve({
            files: [{ name: name + ".todl", text: "concept " + name + "Root;" }],
            resources: [{ name: "theme.mu", text: "resources " + name + "Theme {}" }],
            packageJson: '{\n  "name": "@scope/' + name + '"\n}',
            metadata: '{\n  "kind": "library"\n}',
            compiled: '{\n  "nodes": []\n}',
            rawModel: '{"nodes":[]}',
            dependencies: ["@scope/base-" + name],
            versions: ["0.1.0"],
            latest: "0.1.0",
          }),
      },
    };
  });
}

// The rail cells are 48×48 SVG groups stacked from the top; index 0 = Home,
// index 1 = Packages. Click the second cell's centre to activate it.
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

function hasText(window: Page, text: string): Promise<boolean> {
  return window.evaluate(
    (t) =>
      Array.from(document.querySelectorAll("#app text, #app tspan"))
        .map((n) => (n.textContent ?? "").trim())
        .some((s) => s === t),
    text,
  );
}

// The bounding box of an SVG tree-row label (first match, in the side panel).
function labelBox(window: Page, label: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return window.evaluate((t) => {
    for (const el of Array.from(document.querySelectorAll("#app text, #app tspan"))) {
      if ((el.textContent ?? "").trim() === t) {
        const r = (el as Element).getBoundingClientRect();
        if (r.left < 360) return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return null;
  }, label);
}

// Expand a tree row by clicking its chevron — just left of the label text.
async function expandRow(window: Page, label: string): Promise<void> {
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x - 14, b.y + b.h / 2);
}

// Select a tree row by clicking its label.
async function selectRow(window: Page, label: string): Promise<void> {
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
}

// The source/JSON renders in a Monaco editor (HTML in a <foreignObject>), not
// SVG <text> — read its rendered lines for content assertions.
function editorText(window: Page): Promise<string> {
  return window.evaluate(() => {
    const lines = document.querySelector("#app .monaco-editor .view-lines");
    return lines ? (lines.textContent ?? "") : "";
  });
}

test("Packages capability lists registry packages as a tree; Refresh re-fetches", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);

  // Activate the Packages capability — its service lazily fetches on OnActivated.
  await clickRailCapability(window, 1);

  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "azure"), { timeout: 10_000 }).toBe(true);

  // Refresh re-fetches: add a package, click the header Refresh, expect it to appear.
  await window.evaluate(() => {
    (window as unknown as { __pkgNames: string[] }).__pkgNames = ["aws", "azure", "gcp"];
  });
  await window.getByText("Refresh", { exact: true }).click();
  await expect.poll(() => hasText(window, "gcp"), { timeout: 10_000 }).toBe(true);

  await app.close();
});

test("expanding a package reveals category nodes; selecting a leaf shows it in the editor", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);
  await clickRailCapability(window, 1);
  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);

  // Expand the package node → lazy fetch builds the category nodes.
  await expandRow(window, "aws");
  await expect.poll(() => hasText(window, "Metadata"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "package.json"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Compiled code"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Resources"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Published versions"), { timeout: 10_000 }).toBe(true);

  // Expand Resources → the mural resource leaf; select it → its text in the editor.
  await expandRow(window, "Resources");
  await expect.poll(() => hasText(window, "theme.mu"), { timeout: 10_000 }).toBe(true);
  await selectRow(window, "theme.mu");
  await expect.poll(async () => (await editorText(window)).includes("awsTheme"), { timeout: 10_000 }).toBe(true);

  // Expand Files → the .todl file leaf; select it → its source in the editor.
  await expandRow(window, "Files");
  await expect.poll(() => hasText(window, "aws.todl"), { timeout: 10_000 }).toBe(true);
  await selectRow(window, "aws.todl");
  await expect.poll(async () => (await editorText(window)).includes("awsRoot"), { timeout: 10_000 }).toBe(true);

  // Select a JSON category → the editor swaps to that content.
  await selectRow(window, "Metadata");
  await expect.poll(async () => (await editorText(window)).includes("library"), { timeout: 10_000 }).toBe(true);

  await app.close();
});
