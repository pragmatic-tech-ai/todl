import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherLexer } from "../lexer.js";
import { TokenKind } from "../enums.js";
import { CypherSyntaxError } from "../errors.js";

class LexerTestHelper
{
    public static Kinds(src: string): TokenKind[]
    {
        return new CypherLexer(src).Tokenize().map((t) => t.Kind);
    }
}

describe("cypher lexer", () =>
{
    test("keywords fold case; identifiers keep case", () =>
    {
        const toks = new CypherLexer("match (a:Service)").Tokenize();
        assert.equal(toks[0]!.Kind, TokenKind.Keyword);
        assert.equal(toks[0]!.Text, "MATCH");
        const id = toks.find((t) => t.Kind === TokenKind.Identifier && t.Text === "Service");
        assert.ok(id, "Service identifier preserved");
    });

    test("relationship arrows and dashes", () =>
    {
        assert.deepEqual(LexerTestHelper.Kinds("-->"), [TokenKind.Dash, TokenKind.ArrowRight, TokenKind.Eof]);
        assert.deepEqual(LexerTestHelper.Kinds("<--"), [TokenKind.ArrowLeft, TokenKind.Dash, TokenKind.Eof]);
    });

    test("comparison operators", () =>
    {
        assert.deepEqual(LexerTestHelper.Kinds("<> <= >= = < >"), [
            TokenKind.Neq, TokenKind.Lte, TokenKind.Gte, TokenKind.Eq, TokenKind.Lt, TokenKind.Gt, TokenKind.Eof,
        ]);
    });

    test("string and number literals", () =>
    {
        const toks = new CypherLexer("'hi' 42").Tokenize();
        assert.equal(toks[0]!.Kind, TokenKind.String);
        assert.equal(toks[0]!.Text, "hi");
        assert.equal(toks[1]!.Kind, TokenKind.Number);
        assert.equal(toks[1]!.Text, "42");
    });

    test("unterminated string reports position", () =>
    {
        assert.throws(() => new CypherLexer("'oops").Tokenize(), (e: unknown) =>
        {
            return e instanceof CypherSyntaxError && e.Line === 1;
        });
    });

    test("decimal literal lexes as one Number token", () =>
    {
        const toks = new CypherLexer("1.5").Tokenize();
        assert.deepEqual(toks.map((t) => t.Kind), [TokenKind.Number, TokenKind.Eof]);
        assert.equal(toks[0]!.Text, "1.5");
    });

    test("1..2 lexes as integer, range dots, integer (not a decimal)", () =>
    {
        const toks = new CypherLexer("1..2").Tokenize();
        assert.deepEqual(toks.map((t) => t.Text), ["1", ".", ".", "2", ""]);
        assert.equal(toks[0]!.Kind, TokenKind.Number);
        assert.equal(toks[3]!.Kind, TokenKind.Number);
        assert.equal(toks[1]!.Kind, toks[2]!.Kind);
    });

    test("range inside a relationship pattern keeps both bounds as integers", () =>
    {
        const toks = new CypherLexer("[:r*1..2]").Tokenize();
        const nums = toks.filter((t) => t.Kind === TokenKind.Number).map((t) => t.Text);
        assert.deepEqual(nums, ["1", "2"]);
    });
});
