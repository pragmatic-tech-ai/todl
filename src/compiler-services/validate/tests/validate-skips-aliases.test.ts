import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode } from "../validate.js";

class Harness
{
    static check(text: string)
    {
        return check([{ uri: "shop.todl", text }]);
    }
}

test("a merged-away instance missing a required field does NOT raise required-missing", () =>
{
    // b is aliased to a by identity on email; b lacks the required `label`, but after
    // merge it is merged-away, so it must not be validated for cardinality.
    const { diagnostics } = Harness.check(`
namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; }
        Customer b { email = "x@y.z"; }
    }
}`);
    assert.equal(diagnostics.filter((d) => d.code === DiagnosticCode.RequiredMissing).length, 0);
});

test("the surviving canonical still reports its OWN genuinely missing required field", () =>
{
    // Single instance, no clustering; `label` is required and absent → still flagged.
    const { diagnostics } = Harness.check(`
namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; }
    }
}`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.RequiredMissing));
});

test("a cluster whose members all lack a required field reports exactly one required-missing (canonical only)", () =>
{
    // Neither a nor b has `label`, so gap-fill cannot supply it. The canonical is still
    // validated (once); its merged-away alias must not contribute a second report.
    const { diagnostics } = Harness.check(`
namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; }
        Customer b { email = "x@y.z"; }
    }
}`);
    assert.equal(diagnostics.filter((d) => d.code === DiagnosticCode.RequiredMissing).length, 1);
});
