import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

test("the prelude declares the `application` annotation (package-level use compiles clean)", () =>
{
    const { diagnostics } = check([{
        uri: "app.todl",
        text: `namespace a { concept C { name : string; } model M : a { C x { name = "X"; } } package { annotate application { } } }`,
    }]);
    assert.deepEqual(diagnostics, []);
});

test("the three application diagnostic codes exist", () =>
{
    assert.equal(DiagnosticCode.ApplicationMultipleRoots, "application.multiple-roots");
    assert.equal(DiagnosticCode.ApplicationRootUndesignated, "application.root-undesignated");
    assert.equal(DiagnosticCode.ApplicationRootNotAModel, "application.root-not-a-model");
});
