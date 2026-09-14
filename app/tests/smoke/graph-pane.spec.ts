import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// A compiled-graph rawModel (nodes + edges across tiers) so selecting
// "Raw model.json" routes to the GraphPaneVM (Visual + Text tabs) rather than the
// plain editor. `compiled` is left as empty-nodes JSON to keep that leaf on the
// plain editor path.
// The three base entities the assertions below rely on (a labeled "Uses: uses"
// edge, an InstanceOf edge, all three tiers), plus a batch of filler instance
// nodes + edges so the load exercises the batched populate path at scale
// (each collection is filled inside one ObservableCollection.Batch => one reset).
const FILLER = 24;
const fillerNodes = Array.from({ length: FILLER }, (_, i) => ({
  id: `f${i}`, tier: "Instance", typeOf: "app_component", attrs: { name: `Filler ${i}` },
}));
const fillerEdges = Array.from({ length: FILLER }, (_, i) => ({
  kind: "InstanceOf", via: null, from: `f${i}`, to: "app_component",
}));

const GRAPH = JSON.stringify({
  nodes: [
    { id: "actor", tier: "Ontology", typeOf: "concept", attrs: { name: "actor" } },
    { id: "app_component", tier: "Ontology", typeOf: "concept", attrs: { name: "app_component" } },
    { id: "app1", tier: "Instance", typeOf: "app_component", attrs: { name: "App One" } },
    ...fillerNodes,
  ],
  edges: [
    { kind: "InstanceOf", via: null, from: "app1", to: "app_component" },
    { kind: "Uses", via: "uses", from: "actor", to: "app_component" },
    ...fillerEdges,
  ],
});

function installFakeRegistry(window: Page): Promise<void> {
  return window.evaluate((graph) => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      registry: {
        list: () => Promise.resolve(["aws"]),
        getPackageContents: () =>
          Promise.resolve({
            files: [{ name: "aws.todl", text: "concept awsRoot;" }],
            resources: [],
            packageJson: '{\n  "name": "@scope/aws"\n}',
            metadata: '{\n  "kind": "library"\n}',
            compiled: '{\n  "nodes": []\n}',
            rawModel: graph,
            dependencies: [],
            versions: ["0.1.0"],
            latest: "0.1.0",
          }),
      },
    };
  }, GRAPH);
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

function hasText(window: Page, text: string): Promise<boolean> {
  return window.evaluate(
    (t) =>
      Array.from(document.querySelectorAll("#app text, #app tspan"))
        .map((n) => (n.textContent ?? "").trim())
        .some((s) => s === t),
    text,
  );
}

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

async function expandRow(window: Page, label: string): Promise<void> {
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x - 14, b.y + b.h / 2);
}

async function selectRow(window: Page, label: string): Promise<void> {
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
}

// Constructor histogram across the rendered mural visual tree.
function ctorHisto(window: Page): Promise<Record<string, number>> {
  return window.evaluate(() => {
    const S = Symbol.for("mural:visual-backref");
    const h: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const v = (el as unknown as Record<symbol, { constructor?: { name?: string } }>)[S];
      const n = v?.constructor?.name;
      if (n) h[n] = (h[n] ?? 0) + 1;
    }
    return h;
  });
}

test("selecting Raw model.json shows the Visual+Text tabbed graph view", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);
  await clickRailCapability(window, 1);
  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);

  await expandRow(window, "aws");
  await expect.poll(() => hasText(window, "Raw model.json"), { timeout: 10_000 }).toBe(true);

  await selectRow(window, "Raw model.json");

  // The tabbed graph view mounts: Visual/Text switch headers render, and Visual is
  // shown by default so the Diagram + node tiles (Figures) + tier toggles appear.
  await expect.poll(() => hasText(window, "Visual"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Text"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await ctorHisto(window)).Diagram ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await ctorHisto(window)).Figure ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  // The batched populate rendered the whole graph (3 base + 24 filler instances)
  // in one reset per collection — assert the full node set materialized.
  await expect.poll(async () => (await ctorHisto(window)).Figure ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(27);
  await expect.poll(() => hasText(window, "Meta"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Uses: uses"), { timeout: 10_000 }).toBe(true);

  await window.screenshot({ path: "test-results/graph-pane.png" });
  await app.close();
});
