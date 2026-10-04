import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../../../compiler-services/parse/parser.js";
import { ReferenceIndex, Role } from "../reference-index.js";

class IndexFixture
{
    public static IndexOf(src: string, uri = "d.todl"): ReferenceIndex
    {
        return ReferenceIndex.Build(new Map([[uri, parse(src, uri).namespace]]));
    }
}

test("records extends, field-type, relationship-target and ref occurrences", () =>
{
    const idx = IndexFixture.IndexOf([
        "namespace demo {",
        "  concept animal { }",
        "  concept dog : animal { legs : number; relationship owner -> person []; }",
        "  dog rex { }",
        "  person p { pet = rex; }",
        "}",
    ].join("\n"));
    const animalRefs = idx.Get("animal");
    assert.equal(animalRefs.length, 1);
    assert.equal(animalRefs[0]!.Role, Role.Extends);
    assert.equal(idx.Get("number")[0]!.Role, Role.FieldType);
    assert.equal(idx.Get("person")[0]!.Role, Role.RelationshipTarget);
    assert.equal(idx.Get("rex")[0]!.Role, Role.RefValue);
    assert.equal(idx.Get("dog")[0]!.Role, Role.InstanceConcept);
});

test("OccurrenceAt finds the occurrence under a position", () =>
{
    const idx = IndexFixture.IndexOf("namespace demo {\n  concept a { }\n  concept b : a { }\n}");
    // `a` in `: a` is line 3 (0-based line 2), character 14 (the colon is at 13).
    const occ = idx.OccurrenceAt("d.todl", { line: 2, character: 14 });
    assert.equal(occ?.Symbol, "a");
    assert.equal(occ?.Role, Role.Extends);
});

test("a concept referenced from inside a model body is indexed", () =>
{
    const idx = IndexFixture.IndexOf([
        "namespace app {",
        "  concept component { }",
        "  model prod : app {",
        "    component checkout { }",
        "  }",
        "}",
    ].join("\n"));
    const refs = idx.Get("component");
    assert.ok(refs.some((r) => r.Role === Role.InstanceConcept));
});

test("an instanceof target referenced from inside a model body is indexed", () =>
{
    const idx = IndexFixture.IndexOf([
        "namespace app {",
        "  concept component { }",
        "  class component base { }",
        "  model prod : app {",
        "    component c instanceof base { }",
        "  }",
        "}",
    ].join("\n"));
    const refs = idx.Get("base");
    assert.ok(refs.some((r) => r.Role === Role.InstanceOf));
});
