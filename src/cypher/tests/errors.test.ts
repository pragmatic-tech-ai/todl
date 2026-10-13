import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherSyntaxError, CypherSemanticError, CypherError } from "../errors.js";
import { RelDirection, ComparisonOp } from "../enums.js";

describe("cypher errors + enums", () =>
{
    test("CypherSyntaxError carries line and column and is a CypherError", () =>
    {
        const e = new CypherSyntaxError("unexpected token", 2, 7);
        assert.equal(e.Line, 2);
        assert.equal(e.Column, 7);
        assert.ok(e instanceof CypherError);
        assert.match(e.message, /unexpected token/);
    });

    test("CypherSemanticError is a CypherError", () =>
    {
        assert.ok(new CypherSemanticError("nope") instanceof CypherError);
    });

    test("enums expose the SP1 value sets", () =>
    {
        assert.equal(RelDirection.Undirected !== RelDirection.Outgoing, true);
        assert.equal(ComparisonOp.Eq !== ComparisonOp.Neq, true);
    });
});
