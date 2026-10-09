import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { DiagnosticCode } from "../../validate/validate.js";

class LowerIdentityHarness
{
    public static Compile(text: string)
    {
        return load([{ uri: "t.todl", text }]);
    }
}

test("an identity declaration lowers to an Identity node", () =>
{
    const { model, diagnostics } = LowerIdentityHarness.Compile(`namespace n { concept C { k : string; } identity C key k; }`);
    assert.deepEqual(diagnostics, []);
    const ids = model.nodesOfMetaKind(MetaKind.Identity);
    assert.equal(ids.length, 1);
    const node = model.resolve(ids[0]!)!;
    assert.equal(node.attrs.get("concept"), "n.C");
    assert.equal(node.attrs.get("key"), "k");
});

test("identity on an unknown concept is reported", () =>
{
    const { diagnostics } = LowerIdentityHarness.Compile(`namespace n { identity Ghost key k; }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.IdentityUnknownConcept));
});

test("identity with an unknown key is reported", () =>
{
    const { diagnostics } = LowerIdentityHarness.Compile(`namespace n { concept C { k : string; } identity C key nope; }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.IdentityUnknownKey));
});
