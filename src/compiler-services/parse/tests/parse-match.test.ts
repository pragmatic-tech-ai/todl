import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

class Harness
{
    static decls(text: string)
    {
        const result = parse(text);
        assert.deepEqual(result.diagnostics, [], "unexpected parse diagnostics");
        return result.namespace.declarations;
    }
}

test("parses a match declaration with two same-when rules", () =>
{
    const src = `namespace n { concept C { email : string; tax : string; country : string; }
        match C { same when a.email == b.email; same when a.tax == b.tax and a.country == b.country; } }`;
    const d = Harness.decls(src);
    const m = d.find((x) => x.kind === DeclKind.Match) as { concept: string; rules: { predicate: unknown[] }[] } | undefined;
    assert.ok(m, "expected a MatchDecl");
    assert.equal(m!.concept, "C");
    assert.equal(m!.rules.length, 2);
    assert.ok(m!.rules[0]!.predicate.length > 0, "rule predicate tokens captured");
});

test("an empty match body parses with no rules and no diagnostics", () =>
{
    const d = Harness.decls(`namespace n { concept C { email : string; } match C { } }`);
    const m = d.find((x) => x.kind === DeclKind.Match) as { rules: unknown[] } | undefined;
    assert.ok(m);
    assert.equal(m!.rules.length, 0);
});

test("a malformed match clause is diagnosed while a following clause still parses", () =>
{
    const result = parse(`namespace n { concept C { x : string; } match C { same foo; same when a.x == b.x; } }`);
    assert.ok(result.diagnostics.length > 0, "expected a diagnostic for the malformed clause");
    const m = result.namespace.declarations.find((x) => x.kind === DeclKind.Match) as { rules: unknown[] } | undefined;
    assert.ok(m);
    assert.equal(m!.rules.length, 1);
});
