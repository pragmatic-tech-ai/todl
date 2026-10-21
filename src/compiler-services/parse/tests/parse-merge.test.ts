import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, MergeStrategy } from "../ast.js";

class Harness
{
    static decls(text: string)
    {
        const result = parse(text);
        assert.deepEqual(result.diagnostics, [], "unexpected parse diagnostics");
        return result.namespace.declarations;
    }
}

test("parses a merge declaration with source and latest rules", () =>
{
    const src = `namespace n { concept C { label : string; updated_at : string; }
        merge C { prefer source "crm" for label; prefer latest for updated_at; } }`;
    const m = Harness.decls(src).find((x) => x.kind === DeclKind.Merge) as
        { concept: string; rules: { strategy: MergeStrategy; field: string; source: string | null }[] } | undefined;
    assert.ok(m, "expected a MergeDecl");
    assert.equal(m!.concept, "C");
    assert.equal(m!.rules.length, 2);
    assert.deepEqual(
        m!.rules.map((r) => [r.strategy, r.field, r.source]),
        [[MergeStrategy.Source, "label", "crm"], [MergeStrategy.Latest, "updated_at", null]]);
});

test("an empty merge body parses with no rules and no diagnostics", () =>
{
    const m = Harness.decls(`namespace n { concept C { label : string; } merge C { } }`)
        .find((x) => x.kind === DeclKind.Merge) as { rules: unknown[] } | undefined;
    assert.ok(m);
    assert.equal(m!.rules.length, 0);
});
