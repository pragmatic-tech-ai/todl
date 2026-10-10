import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { Severity, DiagnosticCode } from "../diagnostics/diagnostic.js";

class ResolutionMergeEndToEndFixture
{
    public static readonly Uri = "shop.todl";
    public static readonly CustomerConcept = "shop.Customer";
    public static readonly LabelKey = "label";
    public static readonly UpdatedAtKey = "updated_at";

    public static readonly GapFillSource = `
namespace shop
{
    concept Customer { email : string; label : string; updated_at : string; }
    identity Customer key email;
    merge Customer { prefer latest for updated_at; }

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; updated_at = "2020"; }
        Customer b { email = "x@y.z"; updated_at = "2024"; }
    }
}`;

    public static readonly ConflictSource = `
namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; }
        Customer b { email = "x@y.z"; label = "Beta"; }
    }
}`;

    public static Check(text: string): ReturnType<typeof check>
    {
        return check([{ uri: ResolutionMergeEndToEndFixture.Uri, text }]);
    }
}

test("merge gap-fills a combined customer and resolves a conflict by prefer latest", () =>
{
    const { model, diagnostics } = ResolutionMergeEndToEndFixture.Check(ResolutionMergeEndToEndFixture.GapFillSource);
    assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
    const ids = model.instancesOf(ResolutionMergeEndToEndFixture.CustomerConcept);
    assert.equal(ids.length, 1);
    assert.equal(model.resolve(ids[0]!)!.attrs.get(ResolutionMergeEndToEndFixture.LabelKey), "Acme");
    assert.equal(model.resolve(ids[0]!)!.attrs.get(ResolutionMergeEndToEndFixture.UpdatedAtKey), "2024");
});

test("a conflicting field with no merge rule surfaces resolution.unmerged-conflict", () =>
{
    const { diagnostics } = ResolutionMergeEndToEndFixture.Check(ResolutionMergeEndToEndFixture.ConflictSource);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict && d.severity === Severity.Error));
});
