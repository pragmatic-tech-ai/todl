import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, PolicyAction, PolicyEffect } from "../ast.js";

class Harness
{
    static policy(src: string)
    {
        const result = parse(src);
        return {
            diagnostics: result.diagnostics,
            decl: result.namespace.declarations.find((x) => x.kind === DeclKind.Policy) as
                { concept: string; rules: { effect: PolicyEffect; action: PolicyAction; predicate: unknown[] }[] } | undefined,
        };
    }
}

test("parses a policy declaration with allow/deny rules", () =>
{
    const r = Harness.policy(`namespace n { policy shop.Customer {
        allow read when principal.region == entity.region;
        deny write when entity.locked == true; } }`);
    assert.deepEqual(r.diagnostics, []);
    assert.ok(r.decl, "expected a PolicyDecl");
    assert.equal(r.decl!.concept, "shop.Customer");
    assert.deepEqual(
        r.decl!.rules.map((x) => [x.effect, x.action]),
        [[PolicyEffect.Allow, PolicyAction.Read], [PolicyEffect.Deny, PolicyAction.Write]]);
    for (const rule of r.decl!.rules)
    {
        assert.ok(rule.predicate.length > 0);
    }
});

test("a malformed policy member yields a diagnostic and recovers", () =>
{
    const r = Harness.policy(`namespace n { policy shop.Customer { allow when a == b; } }`);
    assert.ok(r.diagnostics.length > 0);
});
