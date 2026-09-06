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
  const userDataDir = mkdtempSync(join(tmpdir(), "todl-e2e-"));
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  return { app, window };
}

async function clickPackages(window: Page): Promise<void> {
  await window.getByText("Packages", { exact: true }).click();
}

test("no token: the Packages page shows the settings affordance", async () => {
  const { app, window } = await launch();
  await clickPackages(window);
  await expect(window.getByText("Set a GitHub Packages token to browse packages.")).toBeVisible({ timeout: 10_000 });
  await app.close();
});

test("with a fake registry: list -> select -> detail facets -> open in playground", async () => {
  const { app, window } = await launch();

  // Inject an in-page fake bridge BEFORE showing the page (PackagesVM loads on
  // activation). `window.todl` is frozen by contextBridge, so RegistryClient reads
  // the mutable `__todlBridge` override first. Exercises the real Mural VMs +
  // templates, no network.
  await window.evaluate(() => {
    const model = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] };
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      config: {
        get: () => Promise.resolve({ registry: "r", scope: "@pragmatic-tech-ai", org: "o", hasToken: true }),
        setToken: () => Promise.resolve(),
        setSettings: () => Promise.resolve(),
      },
      registry: {
        list: () => Promise.resolve(["aws"]),
        versions: () => Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } }),
        getPackage: () => Promise.resolve({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: ["@pragmatic-tech-ai/tech-architecture"], document: model }),
        resolveClosure: () => Promise.resolve({ metaModels: [], libraries: [model], order: ["@pragmatic-tech-ai/tech-architecture", "@pragmatic-tech-ai/aws"] }),
        getContent: () => Promise.resolve(new Uint8Array()),
        getSources: () => Promise.resolve([{ name: "aws.todl", text: "concept EC2;\n" }]),
        publishDir: () => Promise.resolve(),
      },
    };
  });

  await clickPackages(window);

  // Master list renders the fake package.
  const row = window.getByText("aws", { exact: true });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // Detail facets populate.
  await expect(window.getByText("library", { exact: true })).toBeVisible();
  await expect(window.getByText("2 nodes · 1 edges")).toBeVisible();
  await expect(window.getByText("@pragmatic-tech-ai/tech-architecture  →  @pragmatic-tech-ai/aws")).toBeVisible();

  // Open in Playground round-trips the fake source into the editor (scope to the
  // playground editor — the model-output editor is a second .monaco-editor).
  await window.getByText("Open in Playground").click();
  const editor = window.locator('.monaco-editor[data-uri="inmemory://playground.todl"]');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await expect(editor).toContainText("concept EC2;", { timeout: 10_000 });

  await app.close();
});
