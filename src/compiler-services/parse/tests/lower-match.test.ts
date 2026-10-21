import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { Builder } from "../../model/builder.js";
import { DiagnosticCode } from "../../validate/validate.js";

class Harness
{
    static compile(text: string)
    {
        return load([{ uri: "t.todl", text }]);
    }
}

test("a match block lowers to a Match node with normalized rules", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { email : string; tax : string; country : string; }
         match C { same when a.email == b.email; same when a.tax == b.tax and a.country == b.country; } }`);
    assert.deepEqual(diagnostics, []);
    const ids = model.nodesOfMetaKind(MetaKind.Match);
    assert.equal(ids.length, 1);
    const node = model.resolve(ids[0]!)!;
    const rules = JSON.parse(String(node.attrs.get(Builder.MatchRulesAttr))) as string[][];
    assert.deepEqual(rules, [["email"], ["country", "tax"]]);
});

test("match on an unknown concept is reported", () =>
{
    const { diagnostics } = Harness.compile(`namespace n { match Ghost { same when a.x == b.x; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MatchUnknownConcept));
});

test("a match rule field that is not a concept field is reported", () =>
{
    const { diagnostics } = Harness.compile(
        `namespace n { concept C { email : string; } match C { same when a.nope == b.nope; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MatchUnknownField));
});

test("an unsupported rule shape is reported but other clauses still lower", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { email : string; tax : string; }
         match C { same when a.email == b.tax; same when a.tax == b.tax; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MatchUnsupportedRule));
    const node = model.resolve(model.nodesOfMetaKind(MetaKind.Match)[0]!)!;
    const rules = JSON.parse(String(node.attrs.get(Builder.MatchRulesAttr))) as string[][];
    assert.deepEqual(rules, [["tax"]]);
});

test("rules from two match blocks for the same concept union into one node", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { email : string; tax : string; }
         match C { same when a.email == b.email; }
         match C { same when a.tax == b.tax; } }`);
    assert.deepEqual(diagnostics, []);
    const ids = model.nodesOfMetaKind(MetaKind.Match);
    assert.equal(ids.length, 1);
    const rules = JSON.parse(String(model.resolve(ids[0]!)!.attrs.get(Builder.MatchRulesAttr))) as string[][];
    assert.deepEqual(rules, [["email"], ["tax"]]);
});

test("duplicate rules collapse to one", () =>
{
    const { model } = Harness.compile(
        `namespace n { concept C { email : string; }
         match C { same when a.email == b.email; same when b.email == a.email; } }`);
    const rules = JSON.parse(String(model.resolve(model.nodesOfMetaKind(MetaKind.Match)[0]!)!.attrs.get(Builder.MatchRulesAttr))) as string[][];
    assert.deepEqual(rules, [["email"]]);
});

test("a block with only invalid clauses defines no match node", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { x : string; } match C { same when a.x == "lit"; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MatchUnsupportedRule));
    assert.deepEqual(model.nodesOfMetaKind(MetaKind.Match), []);
});
