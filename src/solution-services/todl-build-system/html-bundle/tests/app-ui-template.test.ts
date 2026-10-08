import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AppUiTemplate } from "../app-ui-template.js";

describe("AppUiTemplate.Render", () =>
{
    test("renders an Application with x:root $service content + implicit DataTemplate", () =>
    {
        const mu = AppUiTemplate.Render("test_waf_architectures");
        assert.match(mu, /^import TestWafArchitecturesApp from "\.\/main\.js"/m);
        assert.match(mu, /Application\s*\{/);
        assert.match(mu, /ContentControl x:root \[ Content = \$service\(TestWafArchitecturesApp\) \]/);
        assert.match(mu, /DataTemplate \[ DataType = TestWafArchitecturesApp \]/);
        assert.match(mu, /Text = \$HelloText/);
        assert.match(mu, /Text = \$ConceptSummary/);
    });

    test("the DataTemplate carries no x:key", () =>
    {
        const mu = AppUiTemplate.Render("widgets");
        assert.doesNotMatch(mu, /x:key/);
    });
});
