import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModelDraft } from "../../../authoring/model-draft.js";

/** A model whose numeric fields (one through a primitive alias) hold every literal shape the draft can carry. */
class NumericFx
{
    public static readonly Uri = "n.todl";
    public static readonly Namespace = "n";
    public static readonly Node = "n.w";
    public static readonly Field = "f";
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
    /** JS numbers set through setField, with the text each is written as. */
    public static readonly Numbers: readonly [number, string][] = [
        [5, "f = 5;"],
        [0.1, "f = 0.1;"],
        [-3, "f = \"-3\";"],
        [1e-7, "f = \"1e-7\";"],
        [1e21, "f = \"1e+21\";"],
        [-0, "f = \"-0\";"],
    ];
    public static readonly NotFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    public static readonly NotFiniteError = /no \.todl literal can hold/;

    public static Draft(text: string): ModelDraft
    {
        return ModelDraft.fromSources([], [{ uri: NumericFx.Uri, text }], { namespace: NumericFx.Namespace });
    }

    /** The field's value after writing `value` with setField, emitting, and parsing the text back. */
    public static RoundTrip(value: number): { Text: string; Back: unknown }
    {
        const draft = NumericFx.Draft(NumericFx.Text);
        draft.setField(NumericFx.Node, NumericFx.Field, value);
        const text = draft.toTodl();
        const back = NumericFx.Draft(text).toJSON().nodes.find((n) => n.id === NumericFx.Node)!.attrs[NumericFx.Field];
        return { Text: text, Back: back };
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

    test("a JS number field is written bare when lexable, else quoted, and parses back to the same value", () =>
    {
        for (const [value, expected] of NumericFx.Numbers)
        {
            const { Text, Back } = NumericFx.RoundTrip(value);
            assert.ok(Text.includes(expected), `${String(value)}: ${Text}`);
            assert.equal(typeof Back, "string");
            assert.ok(Object.is(Number(Back), value), `${String(value)} came back as ${String(Back)}`);
        }
    });

    test("NaN and infinities are refused, never written", () =>
    {
        for (const value of NumericFx.NotFinite)
        {
            assert.throws(() => NumericFx.RoundTrip(value), NumericFx.NotFiniteError);
        }
    });
});
