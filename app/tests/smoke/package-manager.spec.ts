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
