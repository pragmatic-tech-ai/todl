import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { Severity } from "../../compiler-services/diagnostics/diagnostic.js";
import type { IdGenerator } from "../../compiler-services/model/id-generator.js";
import { ModelDraft } from "../model-draft.js";
import { DraftCypherHarness, DraftTestWriter } from "./draft-cypher-harness.js";

// Mints C-like ids (as production Snowflake ids are), so a created instance re-parses after the round-trip.
class CLikeIdGenerator implements IdGenerator
{
    private static readonly Prefix = "w";
    private n = 0;

    public next(): string
    {
        return `${CLikeIdGenerator.Prefix}${this.n++}`;
    }
}

// A member whose own source declares its schema beside its instances. The round-trip must keep every schema
// declaration (and its comments/formatting) and only regenerate the model block.
class CoLocatedFixture
{
    public static readonly Uri = "model.todl";
    public static readonly Namespace = "acme";
    public static readonly Comment = "    // the schema lives beside the instances";
    public static readonly ConceptLine = "    concept Widget { label : string?; secret : string?; }";
    public static readonly Source = [
        "namespace acme",
        "{",
        CoLocatedFixture.Comment,
        CoLocatedFixture.ConceptLine,
        "    model acmeModel : acme",
        "    {",
        "        Widget a1 { label = \"alpha\"; }",
        "    }",
        "}",
        "",
    ].join("\n");

    public static Open(text: string = CoLocatedFixture.Source): ModelDraft
    {
        return ModelDraft.fromSources([], [{ uri: CoLocatedFixture.Uri, text }], { namespace: CoLocatedFixture.Namespace });
    }

    public static Reopen(files: ReadonlyMap<string, string>): ModelDraft
    {
        return ModelDraft.fromSources([], [...files].map(([uri, text]) => ({ uri, text })), { namespace: CoLocatedFixture.Namespace });
    }

    public static InstanceIds(draft: ModelDraft): string[]
    {
        return draft.ownInstances().map((e) => e.id).sort();
    }

    public static Text(draft: ModelDraft): string
    {
        return draft.toTodlByFile().get(CoLocatedFixture.Uri)!;
    }
}

describe("ModelDraft over a member with co-located schema", () =>
{
    test("own-file schema is frozen, not an editable instance", () =>
    {
        const d = CoLocatedFixture.Open();
        assert.deepEqual(d.toJSON().nodes.filter((n) => n.metaKind !== null), []);
        assert.deepEqual(CoLocatedFixture.InstanceIds(d), ["acme.a1"]);
        assert.equal(d.Owns("acme.Widget"), false);
        assert.throws(() => d.remove("acme.Widget"), /frozen/);
    });

    test("round-tripping keeps the schema text verbatim and emits no junk instance", () =>
    {
        const text = CoLocatedFixture.Text(CoLocatedFixture.Open());
        assert.ok(text.includes(CoLocatedFixture.Comment), text);
        assert.ok(text.includes(CoLocatedFixture.ConceptLine), text);
        assert.ok(!/Widget\s*\{\s*\}/.test(text), text);
        const again = CoLocatedFixture.Reopen(new Map([[CoLocatedFixture.Uri, text]]));
        assert.deepEqual(CoLocatedFixture.InstanceIds(again), ["acme.a1"]);
        assert.equal(again.entity("acme.a1")!.field("label"), "alpha");
    });

    test("an added instance persists beside the preserved schema", () =>
    {
        const d = CoLocatedFixture.Open();
        d.add({ concept: "acme.Widget", id: "acme.a2", scalars: new Map([["label", "beta"]]) });
        const files = d.toTodlByFile();
        assert.ok(files.get(CoLocatedFixture.Uri)!.includes(CoLocatedFixture.ConceptLine));
        const again = CoLocatedFixture.Reopen(files);
        assert.deepEqual(CoLocatedFixture.InstanceIds(again), ["acme.a1", "acme.a2"]);
        assert.equal(again.entity("acme.a2")!.field("label"), "beta");
    });

    test("deleting every instance keeps the schema and drops the instances", () =>
    {
        const d = CoLocatedFixture.Open();
        d.remove("acme.a1");
        const text = CoLocatedFixture.Text(d);
        assert.ok(text.includes(CoLocatedFixture.ConceptLine), text);
        assert.ok(!text.includes("a1"), text);
        const again = CoLocatedFixture.Reopen(new Map([[CoLocatedFixture.Uri, text]]));
        assert.deepEqual(CoLocatedFixture.InstanceIds(again), []);
        assert.ok(again.model.resolve("acme.Widget") !== undefined);
    });

    test("a Cypher CREATE applied to the draft persists without corrupting the schema", () =>
    {
        const d = CoLocatedFixture.Open();
        DraftCypherHarness.Engine(d, new DraftTestWriter(d, new CLikeIdGenerator())).Execute("CREATE (:acme.Widget {label: 'zeta'})");
        const files = d.toTodlByFile();
        assert.ok(files.get(CoLocatedFixture.Uri)!.includes(CoLocatedFixture.ConceptLine));
        const labels = CoLocatedFixture.Reopen(files).ownInstances().map((e) => e.field("label")).sort();
        assert.deepEqual(labels, ["alpha", "zeta"]);
    });

    test("the single-file toTodl() path keeps co-located schema too", () =>
    {
        const d = ModelDraft.fromSource([], CoLocatedFixture.Source, { namespace: CoLocatedFixture.Namespace });
        const text = d.toTodl();
        assert.ok(text.includes(CoLocatedFixture.ConceptLine), text);
        assert.ok(!/Widget\s*\{\s*\}/.test(text), text);
    });
});

describe("ModelDraft multi-file round-trip persists deletions", () =>
{
    test("a file whose every instance was deleted is still emitted, so the deletion is written", () =>
    {
        const base = check([{ uri: "shop.todl", text: "namespace shop { concept Customer { name : string?; } }" }]).model;
        const a = "namespace app { import shop; model M : shop { Customer c1 { name = \"A\"; } } }";
        const b = "namespace app { import shop; model M : shop { Customer c2 { name = \"B\"; } } }";
        const d = ModelDraft.fromSources([base], [{ uri: "a.todl", text: a }, { uri: "b.todl", text: b }], { namespace: "app" });
        d.remove("app.c2");
        const files = d.toTodlByFile();
        assert.deepEqual([...files.keys()].sort(), ["a.todl", "b.todl"]);
        const again = ModelDraft.fromSources([base], [...files].map(([uri, text]) => ({ uri, text })), { namespace: "app" });
        assert.deepEqual(again.ownInstances().map((e) => e.id), ["app.c1"]);
    });
});

// An `annotate` block on a co-located term compiles to an annotation application node (no metaKind) hanging off the
// term by an Annotated edge. It is schema, like the term: never an own instance, never re-emitted into a model block.
class AnnotatedTermFixture
{
    public static readonly Uri = "model.todl";
    public static readonly Namespace = "acme";
    public static readonly Application = "acme.Kinds.Big@todl.icon";
    public static readonly FileSeparator = "\n";
    public static readonly Source = "namespace acme { concept Widget { label2 : string?; } "
        + "taxonomy Kinds : represents Widget { term Big { annotate icon { path = \"big.svg\"; } } } "
        + "model Shop : acme { Widget a1 { label2 = \"a\"; } } }\n";

    public static Open(files: ReadonlyMap<string, string> = new Map([[AnnotatedTermFixture.Uri, AnnotatedTermFixture.Source]])): ModelDraft
    {
        return ModelDraft.fromSources([], [...files].map(([uri, text]) => ({ uri, text })), { namespace: AnnotatedTermFixture.Namespace });
    }
}

describe("ModelDraft over a member whose co-located term is annotated", () =>
{
    test("the annotation application is frozen schema, not an own instance", () =>
    {
        const d = AnnotatedTermFixture.Open();
        assert.deepEqual(d.ownInstances().map((e) => e.id), ["acme.a1"]);
        assert.equal(d.Owns(AnnotatedTermFixture.Application), false);
    });

    test("an added instance round-trips without re-emitting the annotation into the model block, and still compiles", () =>
    {
        const d = AnnotatedTermFixture.Open();
        d.add({ concept: "acme.Widget", id: "acme.a2", scalars: new Map([["label2", "b"]]) });
        const files = d.toTodlByFile();
        const text = [...files.values()].join(AnnotatedTermFixture.FileSeparator);
        assert.equal(text.split("annotate icon").length - 1, 1, text);
        assert.ok(!/icon\s+\w+\s*\{/.test(text.replace(/annotate icon/g, "")), text);
        const again = AnnotatedTermFixture.Open(files);
        assert.deepEqual(again.diagnostics.filter((x) => x.severity === Severity.Error), []);
        assert.deepEqual(again.ownInstances().map((e) => e.id).sort(), ["acme.a1", "acme.a2"]);
    });
});
