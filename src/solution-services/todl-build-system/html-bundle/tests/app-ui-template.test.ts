import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compile } from "@pragmatic-tech-ai/mural/compiler";
import { Repository } from "../../../../compiler-services/model/model.js";
import { AppUiTemplate } from "../app-ui-template.js";

// A "widget"/"gadget" repo — two concepts, one already plural-shaped, so the
// per-concept collection-accessor derivation (pluralize(camelCase(id))) has
// something non-trivial to get right.
function twoConceptRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.defineConcept("gadget");
    b.addField("gadget", "label", "string");
    b.commit();
    return r;
}

function emptyRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.commit();
    return r;
}

describe("AppUiTemplate.Render", () =>
{
    test("starts with the generated marker", () =>
    {
        const markup = AppUiTemplate.Render(twoConceptRepo());
        assert.equal(markup.split("\n")[0], AppUiTemplate.GeneratedMarker);
    });

    test("root visual carries x:root under an Application root", () =>
    {
        const markup = AppUiTemplate.Render(twoConceptRepo());
        assert.match(markup, /Application \{/);
        assert.match(markup, /x:root/);
    });

    test("binds each concept's ListBox to the same collection accessor generateReadClient emits", () =>
    {
        const markup = AppUiTemplate.Render(twoConceptRepo());
        // pluralize(camelCase("widget")) === "widgets"; pluralize(camelCase("gadget")) === "gadgets" —
        // must match ModelDataSource's generated `get widgets()` / `get gadgets()` accessors exactly.
        assert.match(markup, /ItemsSource = \$widgets/);
        assert.match(markup, /ItemsSource = \$gadgets/);
    });

    test("renders a placeholder section when the model has no concepts", () =>
    {
        const markup = AppUiTemplate.Render(emptyRepo());
        assert.match(markup, /This model has no concepts yet\./);
    });

    test("the generated markup actually compiles as an application", () =>
    {
        const markup = AppUiTemplate.Render(twoConceptRepo());
        const result = compile(markup);
        assert.equal(result.kind, "application");
    });

    test("an empty-model app also compiles", () =>
    {
        const markup = AppUiTemplate.Render(emptyRepo());
        const result = compile(markup);
        assert.equal(result.kind, "application");
    });
});
