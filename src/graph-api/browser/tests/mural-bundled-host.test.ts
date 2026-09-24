import { test } from "node:test";
import assert from "node:assert/strict";
import { type ApplicationInitOptions } from "@pragmatic-tech-ai/mural";
import { Material, MaterialLight } from "@pragmatic-tech-ai/mural/resources/material";
import { HeadlessTarget, SvgDrawingContext } from "@pragmatic-tech-ai/mural/visual-engine";
import { ModelBrowserVM, ConceptHeaderVM, InstanceRowVM } from "../../../application/model-browser-vm.js";
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

    public static readonly Theme: ApplicationInitOptions = { theme: Material, scheme: MaterialLight };

    public static Labels(vm: ModelBrowserVM): string[]
    {
        return vm.Rows.ToArray().map((row) =>
        {
            if (row instanceof ConceptHeaderVM) return row.Concept;
            if (row instanceof InstanceRowVM) return row.Text;
            return "";
        });
    }
}

// The DOM mount (new HtmlTarget) is proven only by the built artifact; in Node we drive
// the same chain up to the visual tree + a headless paint, mirroring Wave 3c's e2e.
test("payload boots through MuralHost into a ModelBrowserVM over the root model", async () =>
{
    const { app } = await MuralHost.Run(BundledModelRegistry.From(Fixtures.Payload()), Fixtures.Theme);
    const vm = app.Resources.Root!.DataContext as ModelBrowserVM;
    const labels = Fixtures.Labels(vm);
    assert.ok(labels.includes("widget"), `expected concept "widget" in ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("wc"), 'expected instance id "wc"');
});

test("the booted view paints headlessly without throwing", async () =>
{
    const { app } = await MuralHost.Run(BundledModelRegistry.From(Fixtures.Payload()), Fixtures.Theme);
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
