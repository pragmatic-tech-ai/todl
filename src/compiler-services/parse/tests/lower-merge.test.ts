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

test("a merge block lowers to a Merge node with serialized rules", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { label : string; updated_at : string; }
         merge C { prefer source "crm" for label; prefer latest for updated_at; } }`);
    assert.deepEqual(diagnostics, []);
    const ids = model.nodesOfMetaKind(MetaKind.Merge);
    assert.equal(ids.length, 1);
    const rules = JSON.parse(String(model.resolve(ids[0]!)!.attrs.get(Builder.MergeRulesAttr)));
    assert.deepEqual(rules, [
        { field: "label", strategy: "source", source: "crm" },
        { field: "updated_at", strategy: "latest", source: null },
    ]);
});

test("merge on an unknown concept is reported", () =>
{
    const { diagnostics } = Harness.compile(`namespace n { merge Ghost { prefer latest for x; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MergeUnknownConcept));
});

test("a merge rule field not on the concept is reported, other rules still lower", () =>
{
    const { model, diagnostics } = Harness.compile(
        `namespace n { concept C { label : string; } merge C { prefer latest for nope; prefer source "crm" for label; } }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.MergeUnknownField));
    const rules = JSON.parse(String(model.resolve(model.nodesOfMetaKind(MetaKind.Merge)[0]!)!.attrs.get(Builder.MergeRulesAttr)));
    assert.deepEqual(rules, [{ field: "label", strategy: "source", source: "crm" }]);
});
