import { test } from "node:test";
import assert from "node:assert/strict";
import { type ApplicationInitOptions, type Visual } from "@pragmatic-tech-ai/mural";
import { HeadlessTarget, SvgDrawingContext } from "@pragmatic-tech-ai/mural/visual-engine";
import { Material, MaterialLight } from "@pragmatic-tech-ai/mural/resources/material";
import { TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { MuralHost } from "../mural-host.js";
import { AppRegistry } from "../../codegen/tests/fixtures/demo-app.package.generated.js";

class Fixtures
{
    public static readonly Theme: ApplicationInitOptions = { theme: Material, scheme: MaterialLight };

    // Every TextBlock's text in the rendered tree — the item DataTemplates only
    // exist after the ItemsControl stamps its containers during a layout pass.
    public static TextBlockTexts(root: Visual): string[]
    {
        const out: string[] = [];
        const walk = (v: Visual): void =>
        {
            if (v instanceof TextBlock)
            {
                out.push(String(v.Text));
            }
            for (const c of v.visualChildren)
            {
                walk(c);
            }
        };
        walk(root);
        return out;
    }
}

// Regression guard for the black-screen bug's final cause: the model-browser
// ItemsControl had no ItemsPanel, so it materialized zero item containers and the
// page rendered a themed-but-empty box. A plain ItemsControl has no default panel.
// This drives a real layout pass (Measure/Arrange stamps the item containers) and
// asserts the row TextBlocks exist with their bound text — the prior tests only
// checked the VM/DataContext, never that the rows actually rendered.
test("the model-browser ItemsControl stamps a TextBlock per row after layout", async () =>
{
    const { app } = await MuralHost.Run(AppRegistry.Create(), Fixtures.Theme);
    const target = new HeadlessTarget(400, 600);
    target.Content = app.Resources.Root;
    target.Render(new SvgDrawingContext());   // drive Measure/Arrange -> container generation

    const texts = Fixtures.TextBlockTexts(app.Resources.Root!);
    assert.ok(texts.length >= 2, `expected stamped row TextBlocks, got ${texts.length}: ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("service"), `expected concept header "service" in ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("api"), `expected instance row "api" in ${JSON.stringify(texts)}`);
});
