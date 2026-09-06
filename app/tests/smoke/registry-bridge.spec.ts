import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("config.get round-trips renderer -> preload -> ipcMain -> stores -> renderer", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"]; // else Electron runs as plain Node (known gotcha)

  // A clean userData profile → deterministic `hasToken:false` regardless of any
  // token a developer set in the app's real userData on this machine.
  const userDataDir = mkdtempSync(join(tmpdir(), "todl-e2e-"));

  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 }); // renderer mounted

  const config = await window.evaluate(() => window.todl.config.get());
  expect(config).toMatchObject({
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    hasToken: false, // fresh userData → no token; and the token value is never exposed
  });
  expect(config).not.toHaveProperty("token");

  await app.close();
});
