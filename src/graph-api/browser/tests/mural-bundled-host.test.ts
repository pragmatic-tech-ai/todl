import { test } from "node:test";
import assert from "node:assert/strict";
import { Application, type Visual } from "@pragmatic-tech-ai/mural";
import { HeadlessTarget, SvgDrawingContext } from "@pragmatic-tech-ai/mural/visual-engine";
import { TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { Repository } from "../../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../../compiler-services/emit/json.js";
import { BundledModelRegistry, type BundledAppPayload } from "../../../model-data/bundled-model-registry.js";
import { MuralHost } from "../../../application/mural-host.js";
import { MuralBundledHost } from "../mural-bundled-host.js";

class Fixtures
{
    public static WidgetShard(id: string): TodlDocument
    {
        const r = new Repository();
        const b = r.builder();
        b.definePrimitive("string");
        b.defineConcept("widget");
        b.addField("widget", "label", "string");
        b.assertInstance("widget", id);
        b.setField(id, "label", id);
        b.commit();
        return toJSON(r);
    }

    public static Payload(): BundledAppPayload
    {
        return { shards: { core: Fixtures.WidgetShard("wc") }, root: "core" };
    }

    public static AllTexts(root: Visual): string[]
    {
        const out: string[] = [];
        const walk = (v: Visual): void =>
        {
            if (v instanceof TextBlock) out.push(v.Text ?? "");
            for (const c of v.visualChildren) walk(c);
        };
        walk(root);
        return out;
    }
}

// The DOM mount (new HtmlTarget) is proven only by the built artifact; in Node we drive
// the same chain up to the visual tree + a headless paint, mirroring Wave 3c's e2e.
test("payload boots through MuralHost and the view shows the root model's instances", async () =>
{
    const { app } = await MuralHost.Run(BundledModelRegistry.From(Fixtures.Payload()));
    const texts = Fixtures.AllTexts(app.Resources.Root!);
    assert.ok(texts.includes("widget"), `expected concept "widget" in ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("wc"), 'expected instance id "wc"');
});

test("the booted view paints headlessly without throwing", async () =>
{
    const { app } = await MuralHost.Run(BundledModelRegistry.From(Fixtures.Payload()));
    const target = new HeadlessTarget(400, 300);
    target.Content = app.Resources.Root;
    const dc = new SvgDrawingContext();
    target.Render(dc);
    assert.ok(dc.ToFragment().length > 0, "expected a non-empty SVG fragment");
});

// Under plain Node there is no `document`/`window`, so the module entry is inert.
test("Main returns early (inert) when there is no DOM", async () =>
{
    await assert.doesNotReject(() => MuralBundledHost.Main());
});
