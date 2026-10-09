import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { Severity } from "../diagnostics/diagnostic.js";

class ResolutionEndToEndFixture
{
    public static readonly Source = `
namespace shop
{
    concept Customer { email : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; }
        Customer b { email = "x@y.z"; }
    }
}
`;
    public static readonly Uri = "shop.todl";
    public static readonly CustomerConcept = "shop.Customer";
}

test("checkAgainst resolves duplicate-key instances to one canonical", () =>
{
    const { model, diagnostics } = check([{ uri: ResolutionEndToEndFixture.Uri, text: ResolutionEndToEndFixture.Source }]);
    assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
    assert.equal(model.instancesOf(ResolutionEndToEndFixture.CustomerConcept).length, 1);
});
