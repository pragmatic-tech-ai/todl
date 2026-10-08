import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../../../compiler-services/model/model.js";
import { generateReadClient } from "../../../../codegen/read-client.js";
import { AppNaming } from "../app-naming.js";

const DTO_NAMES = ["widgets_demo", "test_waf_architectures", "tech-catalog", "Widgets"];

function minimalRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.commit();
    return r;
}

test("DtoClass / AppClass derive PascalCase names from the model name", () =>
{
    assert.equal(AppNaming.DtoClass("test_waf_architectures"), "TestWafArchitectures");
    assert.equal(AppNaming.AppClass("test_waf_architectures"), "TestWafArchitecturesApp");
});

test("AppNaming.DtoClass equals the class read-client actually emits", () =>
{
    for (const name of DTO_NAMES)
    {
        const js = generateReadClient(minimalRepo(), { name, importSpecifier: "@pragmatic-tech-ai/todl" });
        assert.ok(js.includes(`export class ${AppNaming.DtoClass(name)} extends ModelDataSource`), name);
    }
});
