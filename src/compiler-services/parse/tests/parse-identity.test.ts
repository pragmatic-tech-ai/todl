import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

function decls(text: string)
{
    const result = parse(text);
    assert.deepEqual(result.diagnostics, [], "unexpected parse diagnostics");
    return result.namespace.declarations;
}

test("parses an identity declaration", () =>
{
    const d = decls(`namespace n { concept C { k : string; } identity C key k; }`);
    const id = d.find((x) => x.kind === DeclKind.Identity);
    assert.ok(id, "expected an IdentityDecl");
    assert.equal((id as { concept: string }).concept, "C");
    assert.equal((id as { key: string }).key, "k");
});
