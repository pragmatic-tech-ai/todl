import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

async function launch(): Promise<{ app: ElectronApplication; window: Page }> {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), "todl-e2e-"))}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  return { app, window };
}

test("Setup shows token status + env-var option; Publish picks a dir then publishes", async () => {
  const { app, window } = await launch();
  await window.evaluate(() => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      config: {
        get: () => Promise.resolve({ registry: "https://npm.pkg.github.com", scope: "@pragmatic-tech-ai", org: "pragmatic-tech-ai", tokenSource: "stored", tokenEnvVar: "", hasToken: false }),
        setToken: () => Promise.resolve(),
        useEnvToken: () => Promise.resolve(),
        listEnvVars: () => Promise.resolve(["GH_PAT", "PATH"]),
        setSettings: () => Promise.resolve(),
      },
      registry: { publishDir: () => Promise.resolve() },
      dialog: { pickDirectory: () => Promise.resolve("/tmp/my-lib") },
    };
  });

  // Setup: status line + env-var option render.
  await window.getByText("Setup", { exact: true }).click();
  await expect(window.getByText("Token source: stored token — not set ✗")).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText("Use env var")).toBeVisible();

  // Publish: choose folder → path shows → publish reports success.
  await window.getByText("Publish", { exact: true }).click();
  await window.getByText("Choose folder…").click();
  await expect(window.getByText("/tmp/my-lib")).toBeVisible({ timeout: 10_000 });
  await window.getByText("Publish to registry").click();
  await expect(window.getByText("Published /tmp/my-lib ✓")).toBeVisible({ timeout: 10_000 });

  await app.close();
});
