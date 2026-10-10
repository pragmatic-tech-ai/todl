import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { Severity, DiagnosticCode } from "../diagnostics/diagnostic.js";

class Harness
{
    private static readonly Uri = "shop.todl";

    public static Check(text: string)
    {
        return check([{ uri: Harness.Uri, text }]);
    }
}

test("merge gap-fills a combined customer and resolves a conflict by prefer latest", () =>
{
    const { model, diagnostics } = Harness.Check(`
namespace shop
{
    concept Customer { email : string; label : string?; updated_at : string; }
    identity Customer key email;
    merge Customer { prefer latest for updated_at; }

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; updated_at = "2020"; }
        Customer b { email = "x@y.z"; updated_at = "2024"; }
    }
}`);
    assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
    const ids = model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(model.resolve(ids[0]!)!.attrs.get("label"), "Acme");
    assert.equal(model.resolve(ids[0]!)!.attrs.get("updated_at"), "2024");
});

test("a conflicting field with no merge rule surfaces resolution.unmerged-conflict", () =>
{
    const { diagnostics } = Harness.Check(`
namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; }
        Customer b { email = "x@y.z"; label = "Beta"; }
    }
}`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict));
});
