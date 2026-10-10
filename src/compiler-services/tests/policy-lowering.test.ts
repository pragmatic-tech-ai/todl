import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../api.js";
import { MetaKind } from "../model/kinds.js";
import { Builder } from "../model/builder.js";

const SRC = `namespace shop
{
    concept Customer { region : string; classification : string; }
    policy Customer
    {
        allow read when principal.region == entity.region;
        deny read when entity.classification == "restricted";
    }
}`;

test("policy lowers to a <concept>@policy node with serialized rules", () =>
{
    const { model, diagnostics } = check([{ uri: "shop.todl", text: SRC }]);
    assert.equal(diagnostics.filter((d) => d.code.startsWith("policy.")).length, 0);
    const node = model.resolve("shop.Customer@policy");
    assert.ok(node !== undefined);
    assert.equal(node!.metaKind, MetaKind.Policy);
    const rules = JSON.parse(node!.attrs.get(Builder.PolicyRulesAttr) as string);
    assert.equal(rules.length, 2);
    assert.equal(rules[0].effect, "allow");
    assert.equal(rules[0].action, "read");
    assert.ok(rules[0].predicate !== undefined);
});

test("unknown concept and unknown entity field are diagnosed; rule dropped", () =>
{
    const ghost = check([{ uri: "g.todl", text: `namespace s { policy Ghost { allow read when entity.x == "y"; } }` }]);
    assert.ok(ghost.diagnostics.some((d) => d.code === "policy.unknown-concept"));

    const badField = check([{ uri: "b.todl", text: `namespace s { concept C { a : string; } policy C { allow read when entity.notAField == "y"; } }` }]);
    assert.ok(badField.diagnostics.some((d) => d.code === "policy.unknown-field"));
});

test("a malformed predicate drops the rule (policy.unsupported-rule) and does not silently lower", () =>
{
    const bad = check([{ uri: "m.todl", text: `namespace s { concept C { a : string; } policy C { allow read when entity.a @@ "y"; } }` }]);
    assert.ok(bad.diagnostics.some((d) => d.code === "policy.unsupported-rule"));
    assert.ok(bad.diagnostics.length >= 2);
    assert.equal(bad.model.resolve("s.C@policy"), undefined);
});
