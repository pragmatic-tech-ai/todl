import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { load as loadFiles } from "../loader.js";
import { Cardinality, EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../validate/validate.js";

/** Test shim: wrap raw source strings as SourceFiles and return the model. */
function load(texts: string[])
{
  return loadFiles(texts.map((text, i) => ({ uri: `s${i}.todl`, text }))).model;
}

function fixture(name: string): string
{
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

function corpus()
{
  return load([
    fixture("primitives.todl"),
    fixture("enums.todl"),
    fixture("concepts.todl"),
    fixture("order-fulfillment.todl"),
  ]);
}

test("loads concept schemas from the corpus", () => {
  const model = corpus();
  const task = model.schemaOf("adl.metaModels.bpmn.concepts.Task");
  assert.equal(task.fields.find((field) => field.name === "assignee")?.cardinality, Cardinality.Optional);
  assert.equal(task.fields.find((field) => field.name === "label")?.type, "string");
  assert.equal(task.relationships.find((r) => r.name === "incoming")?.cardinality, Cardinality.Many);
  assert.equal(task.relationships.find((r) => r.name === "livesIn")?.cardinality, Cardinality.One);
});

test("loads taxonomy terms as class members of the represented concept", () => {
  const model = corpus();
  assert.ok(model.termsOf("adl.metaModels.bpmn.enums.TaskType").includes("adl.metaModels.bpmn.enums.TaskType.Service"));
  assert.equal(model.resolve("adl.metaModels.bpmn.enums.TaskType.Service")?.type, "adl.metaModels.bpmn.concepts.Task");
  assert.ok(model.termsOf("adl.metaModels.bpmn.enums.EventType").includes("adl.metaModels.bpmn.enums.EventType.Start"));
});

test("loads instances with scalar attrs and relationship edges", () => {
  const model = corpus();
  assert.equal(model.resolve("demo.orderFulfillment.validatePayment")?.type, "adl.metaModels.bpmn.concepts.Task");
  assert.equal(model.resolve("demo.orderFulfillment.validatePayment")?.attrs.get("label"), "Validate Payment");
  assert.deepEqual(
    model.related("demo.orderFulfillment.validatePayment", EdgeKind.Relationship, Direction.Out, "type"),
    ["adl.metaModels.bpmn.enums.TaskType.Service"],
  );
  assert.deepEqual(
    model.related("demo.orderFulfillment.orderPlaced", EdgeKind.Relationship, Direction.Out, "outgoing"),
    ["demo.orderFulfillment.orderToValidate"],
  );
});

test("an undefined reference is reported, not stubbed", () => {
  const { model, diagnostics } = loadFiles([
    { uri: "t.todl", text: `namespace n { concept Thing {} Thing a instanceof ghost { } }` },
  ]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ReferenceUndefined && /ghost/.test(d.message)));
  assert.equal(model.resolve("ghost"), undefined);
});

test("loads a meta-model descriptor with numeric and list members", () => {
  const model = load([
    `namespace d {
      MetaModel EnterpriseArchitecture {
        name = "EA";
        version = 5;
        rootConcept = model;
        topLevelConcepts = [ Component, Location ];
      }
      concept model { label : string; }
      concept Component { label : string; }
      concept Location { label : string; }
    }`,
  ]);
  assert.ok(model.has("d.EnterpriseArchitecture"));
  assert.equal(model.resolve("d.EnterpriseArchitecture")?.attrs.get("version"), "5");
});

test("nested instances load with contains edges and a meta-model binding", () => {
  const model = load([
    `namespace d {
      model m : EnterpriseArchitecture {
        Location saas3p { label = "x"; }
      }
    }`,
  ]);
  assert.equal(model.resolve("d.saas3p")?.type, "Location");
  assert.deepEqual(model.related("d.m", EdgeKind.Contains, Direction.Out), ["d.saas3p"]);
  assert.equal(model.resolve("d.m")?.attrs.get("MetaModel"), "EnterpriseArchitecture");
});

test("a nested record binds to the parent field typed by its concept", () => {
  const model = load([
    `namespace d {
      concept Host { id : identifier; slots : Slot[]; }
      concept Slot { id : identifier; label : string; }
      Host h1 {
        Slot s1 { label = "S1"; }
      }
    }`,
  ]);
  // Structural containment is still present.
  assert.deepEqual(model.related("d.h1", EdgeKind.Contains, Direction.Out), ["d.s1"]);
  // …and the record populates the `slots` field via a field-named relationship.
  assert.deepEqual(model.related("d.h1", EdgeKind.Relationship, Direction.Out, "slots"), ["d.s1"]);
});

test("a nested record with no matching parent field is contains-only", () => {
  const model = load([
    `namespace d {
      concept Host { id : identifier; }
      concept Slot { id : identifier; }
      Host h1 { Slot s1 { } }
    }`,
  ]);
  assert.deepEqual(model.related("d.h1", EdgeKind.Contains, Direction.Out), ["d.s1"]);
  assert.deepEqual(model.related("d.h1", EdgeKind.Relationship, Direction.Out), []);
});

test("ambiguous field binding (two fields of the same type) diagnoses and falls back to contains", () => {
  const { model, diagnostics } = loadFiles([
    {
      uri: "s.todl",
      text: `namespace d {
        concept Host { id : identifier; a : Slot[]; b : Slot[]; }
        concept Slot { id : identifier; }
        Host h1 { Slot s1 { } }
      }`,
    },
  ]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.AmbiguousFieldBinding));
  assert.deepEqual(model.related("d.h1", EdgeKind.Contains, Direction.Out), ["d.s1"]);
  assert.deepEqual(model.related("d.h1", EdgeKind.Relationship, Direction.Out), []);
});

test("a |-composed enum-flag value loads as the legacy scalar string", () => {
  const model = load([
    `namespace d { Location onPrem { type = physical | onPremises | logicalGrouping; } }`,
  ]);
  assert.equal(model.resolve("d.onPrem")?.attrs.get("type"), "physical | onPremises | logicalGrouping");
});

test("the loaded process satisfies its invariants and target types", () => {
  const model = corpus();
  const diagnostics = model.validate();
  const blocking = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === DiagnosticCode.InvariantFailed ||
      diagnostic.code === DiagnosticCode.TargetTypeMismatch,
  );
  assert.deepEqual(blocking, []);
});
