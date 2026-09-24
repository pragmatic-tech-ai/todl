import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function textOf(body: string): string
{
    return `namespace a { concept C { name : string; } ${body} }`;
}

test("explicit model-level mark: that model is the root", () =>
{
    const { model, diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M1 : a { C x { name = "X"; } } model M2 : a { annotate application { } C y { name = "Y"; } }`) }]);
    assert.deepEqual(diagnostics, []);
    assert.notEqual(model.resolve("M2@application"), undefined);
    assert.equal(model.resolve("M1@application"), undefined);
});

test("package-level root names the root model", () =>
{
    const { model, diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M1 : a { C x { name = "X"; } } model M2 : a { C y { name = "Y"; } } package { annotate application { root = "M2"; } }`) }]);
    assert.deepEqual(diagnostics, []);
    assert.notEqual(model.resolve("M2@application"), undefined);
    assert.equal(model.resolve("M1@application"), undefined);
});

test("implicit: a single-model application marks the sole model", () =>
{
    const { model, diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M : a { C x { name = "X"; } } package { annotate application { } }`) }]);
    assert.deepEqual(diagnostics, []);
    assert.notEqual(model.resolve("M@application"), undefined);
});

test("library (no application annotation) is never marked and never errors", () =>
{
    const { model, diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M1 : a { C x { name = "X"; } } model M2 : a { C y { name = "Y"; } }`) }]);
    assert.deepEqual(diagnostics, []);
    assert.equal(model.resolve("M1@application"), undefined);
    assert.equal(model.resolve("M2@application"), undefined);
});

test("multiple model-level marks: application.multiple-roots", () =>
{
    const { diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M1 : a { annotate application { } C x { name = "X"; } } model M2 : a { annotate application { } C y { name = "Y"; } }`) }]);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ApplicationMultipleRoots), "expected multiple-roots");
});

test("app package, multiple models, nothing designated: application.root-undesignated", () =>
{
    const { diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M1 : a { C x { name = "X"; } } model M2 : a { C y { name = "Y"; } } package { annotate application { } }`) }]);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ApplicationRootUndesignated), "expected root-undesignated");
});

test("package root naming a non-model: application.root-not-a-model", () =>
{
    const { diagnostics } = check([{ uri: "a.todl", text: textOf(
        `model M : a { C x { name = "X"; } } package { annotate application { root = "nope"; } }`) }]);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ApplicationRootNotAModel), "expected root-not-a-model");
});
