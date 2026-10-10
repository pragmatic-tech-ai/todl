import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { Severity } from "../validate/validate.js";

class ResolutionMatchEndToEndFixture
{
    public static readonly Source = `
namespace shop
{
    concept Customer { email : string; tax : string; }
    identity Customer key email;
    match Customer { same when a.tax == b.tax; }

    model Book : shop
    {
        Customer a { email = "a@x.z"; tax = "T1"; }
        Customer b { email = "b@x.z"; tax = "T1"; }
        Customer c { email = "b@x.z"; tax = "T9"; }
    }
}
`;
    public static readonly Uri = "shop.todl";
    public static readonly CustomerConcept = "shop.Customer";

    public static Check()
    {
        return check([{ uri: ResolutionMatchEndToEndFixture.Uri, text: ResolutionMatchEndToEndFixture.Source }]);
    }
}

test("identity key and match rule fuse transitively into one canonical", () =>
{
    const { model, diagnostics } = ResolutionMatchEndToEndFixture.Check();
    assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
    // a~b via tax match; b~c via email key; so {a,b,c} is one entity.
    assert.equal(model.instancesOf(ResolutionMatchEndToEndFixture.CustomerConcept).length, 1);
});
