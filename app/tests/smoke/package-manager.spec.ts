import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// The registry package names the fake bridge returns; mutated to prove Refresh
// re-fetches. `window.todl` is frozen by contextBridge, so RegistryClient reads
// the mutable `__todlBridge` override first (the production injection seam).
function installFakeRegistry(window: Page): Promise<void> {
  return window.evaluate(() => {
    (window as unknown as { __pkgNames: string[] }).__pkgNames = ["aws", "azure"];
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      registry: {
        list: () =>
          Promise.resolve((window as unknown as { __pkgNames: string[] }).__pkgNames),
        // Selecting a package fetches its detail — deps (getPackage) + files
        // (getSources). Distinctive per-name payloads let the test assert the
        // central view reflects the clicked package.
        getPackage: (ref: { name: string }) =>
          Promise.resolve({ name: ref.name, meta: {}, dependencies: ["@scope/base-" + ref.name], document: {} }),
        getSources: (ref: { name: string }) =>
          Promise.resolve([{ name: ref.name + ".todl", text: "concept " + ref.name + "Root;" }]),
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

// All rendered SVG text joined — for substring checks that survive wrapping
// (a wrapped line splits across tspans, so exact-node matching is brittle).
function allText(window: Page): Promise<string> {
  return window.evaluate(() =>
    Array.from(document.querySelectorAll("#app text, #app tspan"))
      .map((n) => n.textContent ?? "")
      .join(" "),
  );
}

// Click a package row in the side panel (left 300px) by its name text.
async function clickPackageRow(window: Page, name: string): Promise<void> {
  const box = await window.evaluate((n) => {
    for (const el of Array.from(document.querySelectorAll("#app text, #app tspan"))) {
      if ((el.textContent ?? "").trim() === n) {
        const r = (el as Element).getBoundingClientRect();
        if (r.left < 300) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, name);
  if (box === null) throw new Error(`package row "${name}" not found`);
  await window.mouse.click(box.x, box.y);
}

test("Packages capability lists registry packages; Refresh re-fetches", async () => {
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

test("selecting a package shows its content in the central content host", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);
  await clickRailCapability(window, 1);
  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);

  // Select a package → the central content host shows its PackageView: the
  // dependency header + its source files (fetched via getPackage + getSources).
  await clickPackageRow(window, "aws");
  await expect.poll(async () => (await allText(window)).includes("base-aws"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("aws.todl"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await allText(window)).includes("awsRoot"), { timeout: 10_000 }).toBe(true);

  await app.close();
});
