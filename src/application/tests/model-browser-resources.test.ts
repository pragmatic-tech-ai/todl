import { test } from "node:test";
import assert from "node:assert/strict";
import { Border, DataTemplate } from "@pragmatic-tech-ai/mural/basic";
import { ConceptHeaderVM, InstanceRowVM } from "../model-browser-vm.js";
import { ModelBrowserResources } from "../model-browser.mu.js";

test("Clone exposes a Border x:root and a DataTemplate per row VM type", () =>
{
    const dict = ModelBrowserResources.Clone();
    assert.ok(dict.Root instanceof Border, "expected the x:root to be a Border");
    assert.ok(dict.Resolve(ConceptHeaderVM) instanceof DataTemplate, "expected a header template keyed by ConceptHeaderVM");
    assert.ok(dict.Resolve(InstanceRowVM) instanceof DataTemplate, "expected a row template keyed by InstanceRowVM");
});
