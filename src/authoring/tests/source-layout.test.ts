import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../compiler-services/parse/parser.js";
import { Severity } from "../../compiler-services/diagnostics/diagnostic.js";
import { ModelBlockSplicer, SourceLayout } from "../source-layout.js";

class SpliceFixture
{
    public static readonly Uri = "m.todl";

    public static Parses(text: string): boolean
    {
        return !parse(text, SpliceFixture.Uri).diagnostics.some((d) => d.severity === Severity.Error);
    }
}

describe("SourceLayout", () =>
{
    test("classifies model-only, co-located and schema-only files", () =>
    {
        const modelOnly = SourceLayout.Of(SpliceFixture.Uri, "namespace a { model M : a { } }");
        const coLocated = SourceLayout.Of(SpliceFixture.Uri, "namespace a { concept C { } model M : a { } }");
        const schemaOnly = SourceLayout.Of(SpliceFixture.Uri, "namespace a { concept C { } }");
        assert.deepEqual([modelOnly.HasModel, modelOnly.HasSchema], [true, false]);
        assert.deepEqual([coLocated.HasModel, coLocated.HasSchema], [true, true]);
        assert.deepEqual([schemaOnly.HasModel, schemaOnly.HasSchema], [false, true]);
    });
});

describe("ModelBlockSplicer", () =>
{
    test("replaces only the model body, keeping the original header (model id included) verbatim", () =>
    {
        const original = "namespace a\n{\n  concept C { x : string?; }\n  model Mine : a\n  {\n    C old { x = \"1\"; }\n  }\n}\n";
        const emitted = "namespace a\n{\n  model aModel : a {\n    C fresh {\n      x = \"2\";\n    }\n  }\n}\n";
        const out = ModelBlockSplicer.Splice(SpliceFixture.Uri, original, emitted);
        assert.ok(out.includes("model Mine : a"), out);
        assert.ok(!out.includes("aModel"), out);
        assert.ok(out.includes("C fresh") && !out.includes("C old"), out);
        assert.ok(out.includes("concept C { x : string?; }"), out);
        assert.ok(SpliceFixture.Parses(out), out);
    });

    test("appends a needed library to an existing uses list", () =>
    {
        const original = "namespace a\n{\n  concept C { }\n  model M : a uses t1 { }\n}\n";
        const emitted = "namespace a\n{\n  model M : a uses t1, t2 {\n  }\n}\n";
        assert.ok(ModelBlockSplicer.Splice(SpliceFixture.Uri, original, emitted).includes("model M : a uses t1, t2"));
    });

    test("adds a uses clause when the original had none", () =>
    {
        const original = "namespace a\n{\n  concept C { }\n  model M : a { }\n}\n";
        const emitted = "namespace a\n{\n  model M : a uses t2 {\n  }\n}\n";
        assert.ok(ModelBlockSplicer.Splice(SpliceFixture.Uri, original, emitted).includes("model M : a uses t2"));
    });

    test("adds an import the emitted model needs", () =>
    {
        const original = "namespace a\n{\n  concept C { }\n  model M : a { }\n}\n";
        const emitted = "namespace a\n{\n  import lib;\n  model M : a {\n  }\n}\n";
        const out = ModelBlockSplicer.Splice(SpliceFixture.Uri, original, emitted);
        assert.ok(out.includes("import lib;"), out);
        assert.ok(SpliceFixture.Parses(out), out);
    });

    test("inserts the model block into a schema-only file", () =>
    {
        const original = "namespace a\n{\n  concept C { }\n}\n";
        const emitted = "namespace a\n{\n  model aModel : a {\n    C n1 {\n    }\n  }\n}\n";
        const out = ModelBlockSplicer.Splice(SpliceFixture.Uri, original, emitted);
        assert.ok(out.includes("concept C { }") && out.includes("model aModel : a"), out);
        assert.ok(SpliceFixture.Parses(out), out);
    });

    test("refuses to splice into an original that does not parse", () =>
    {
        assert.throws(() => ModelBlockSplicer.Splice(SpliceFixture.Uri, "namespace a { concept C { ", "namespace a { }"));
    });
});
