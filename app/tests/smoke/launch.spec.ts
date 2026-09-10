import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("app launches and the shell renders the rail + side panel", async () => {
  // Strip ELECTRON_RUN_AS_NODE: launched from a Node/tsx context it makes
  // Electron run as plain Node instead of booting the app (known gotcha).
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];

  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  await expect(window.locator("#app svg").first()).toBeVisible();

  // The shell auto-selects the first rail capability (Home); its service fills
  // the side panel. Assert the Home welcome landing rendered — proof the rail →
  // NavigationService → side-panel path works end to end.
  await expect
    .poll(
      () =>
        window.evaluate(() =>
          Array.from(document.querySelectorAll("#app text, #app tspan"))
            .map((t) => (t.textContent ?? "").trim())
            .some((s) => s.startsWith("Welcome to TODL")),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await app.close();
});
