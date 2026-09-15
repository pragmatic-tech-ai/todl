import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

// Real-data performance smoke for the graph-pane load. Launches the app and
// routes the REAL tech-architecture model.json (443 nodes / 484 usable edges,
// captured as tests/smoke/techarch-model.json) through GraphPaneVM, then times
// how long until every node tile is rendered. This is the case that used to hang
// for minutes (the O(k⁴) connector crossing-optimizer on a 157-connector hub);
// it now loads in a few seconds. The test fails if the graph doesn't fully
// render within LOAD_BUDGET_MS — a guard against that pathology returning.
// PROFILE_MS bounds the poll window (raise it when diagnosing a fresh hang).

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

const PROFILE_MS = Number(process.env["PROFILE_MS"] ?? 45000);
const LOAD_BUDGET_MS = Number(process.env["LOAD_BUDGET_MS"] ?? 30000);

// The real published graph. N is read from it so the "fully rendered" poll uses
// the true node count.
const REAL_GRAPH = readFileSync(resolve(here, "techarch-model.json"), "utf8");
const N = (JSON.parse(REAL_GRAPH).nodes as unknown[]).length;

function installFakeRegistry(window: Page, graph: string): Promise<void> {
    return window.evaluate((g) => {
        (window as unknown as { __todlBridge: unknown }).__todlBridge = {
            registry: {
                list: () => Promise.resolve(["aws"]),
                getPackageContents: () => Promise.resolve({
                    files: [{ name: "aws.todl", text: "concept awsRoot;" }],
                    resources: [], packageJson: '{ "name": "@scope/aws" }',
                    metadata: '{ "kind": "library" }', compiled: '{ "nodes": [] }',
                    rawModel: g, dependencies: [], versions: ["0.1.0"], latest: "0.1.0",
                }),
            },
        };
    }, graph);
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
    return window.evaluate((t) => Array.from(document.querySelectorAll("#app text, #app tspan"))
        .some((n) => (n.textContent ?? "").trim() === t), text);
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

test(`profile graph load real tech-architecture (${N} nodes)`, async () => {
    test.setTimeout(PROFILE_MS + 120_000);
    const env = { ...process.env };
    delete env["ELECTRON_RUN_AS_NODE"];
    const app = await electron.launch({ args: [mainEntry], env });
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });

    await installFakeRegistry(window, REAL_GRAPH);
    await clickRailCapability(window, 1);
    await window.waitForFunction(() => Array.from(document.querySelectorAll("#app text, #app tspan"))
        .some((n) => (n.textContent ?? "").trim() === "aws"), undefined, { timeout: 10_000 });
    await expandRow(window, "aws");
    await window.waitForFunction(() => Array.from(document.querySelectorAll("#app text, #app tspan"))
        .some((n) => (n.textContent ?? "").trim() === "Raw model.json"), undefined, { timeout: 10_000 });

    const target = await labelBox(window, "Raw model.json");
    if (target === null) throw new Error('"Raw model.json" row not found');

    const t0 = Date.now();
    // Fire the selection click without awaiting — a synchronous slow load blocks
    // the handler, so awaiting would stall the test.
    void window.mouse.click(target.x + target.w / 2, target.y + target.h / 2).catch(() => {});

    // Wall-clock wait in the Node test process (independent of the blocked
    // renderer thread). Poll figure count with a short race so a blocked
    // evaluate doesn't stall us.
    let renderedFigures = 0;
    const deadline = t0 + PROFILE_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
            renderedFigures = await Promise.race([
                window.evaluate(() => {
                    const S = Symbol.for("mural:visual-backref");
                    let count = 0;
                    for (const el of Array.from(document.querySelectorAll("*"))) {
                        const v = (el as unknown as Record<symbol, { constructor?: { name?: string } }>)[S];
                        if (v?.constructor?.name === "Figure") count++;
                    }
                    return count;
                }),
                new Promise<number>((r) => setTimeout(() => r(-1), 2000)),
            ]);
        } catch { renderedFigures = -1; }
        console.log(`  [t=${((Date.now() - t0) / 1000).toFixed(0)}s] figures rendered=${renderedFigures}/${N}`);
        if (renderedFigures >= N) break;
    }
    const elapsed = Date.now() - t0;
    console.log(`\n=== real tech-architecture (${N} nodes): elapsed=${(elapsed / 1000).toFixed(1)}s  figures=${renderedFigures}/${N} ===\n`);

    await app.close().catch(() => {});

    // Regression guard: the real graph must fully render within budget. Before the
    // barycenter optimizer fix this hung for minutes (renderedFigures stuck at -1).
    expect(renderedFigures, "all node tiles rendered").toBe(N);
    expect(elapsed, `load within ${LOAD_BUDGET_MS}ms`).toBeLessThan(LOAD_BUDGET_MS);
});
