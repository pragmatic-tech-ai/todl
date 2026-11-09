import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModelDraft } from "../../../authoring/model-draft.js";

/** A model whose numeric fields (one through a primitive alias) hold every literal shape the draft can carry. */
class NumericFx
{
    public static readonly Uri = "n.todl";
    public static readonly Namespace = "n";
    public static readonly Text = `namespace n
{
    primitive Amount : number { }
    concept W { i : integer?; f : number?; a : Amount?; s : string?; neg : integer?; exp : number?; }
    model M : n
    {
        W w { i = 5; f = 2.5; a = 7; s = "9"; neg = "-3"; exp = "1e-7"; }
    }
}`;
    public static readonly Bare = [/i = 5;/, /f = 2\.5;/, /a = 7;/];
    public static readonly Quoted = [/s = "9";/, /neg = "-3";/, /exp = "1e-7";/];

    public static Draft(text: string): ModelDraft
    {
        return ModelDraft.fromSources([], [{ uri: NumericFx.Uri, text }], { namespace: NumericFx.Namespace });
    }
}

describe("numeric field literals", () =>
{
    test("a re-emitted numeric field keeps its bare literal; a string field and unlexable numbers stay quoted", () =>
    {
        const text = NumericFx.Draft(NumericFx.Text).toTodl();
        for (const pattern of NumericFx.Bare) assert.match(text, pattern);
        for (const pattern of NumericFx.Quoted) assert.match(text, pattern);
        assert.equal(NumericFx.Draft(text).toTodl(), text, "the re-emitted text is a fixed point");
    });
});
