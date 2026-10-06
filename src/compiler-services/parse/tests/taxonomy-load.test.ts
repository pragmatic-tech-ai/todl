import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { Tier, EdgeKind, Direction } from "../../model/graph.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function repo(text: string)
{
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

function loadResult(text: string)
{
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]);
}

test("a flat taxonomy loads terms as Instance-tier classes of the represented concept", () => {
  const m = repo(`concept Hue {} taxonomy Color : represents Hue { term Red { label = "Red"; } term Blue {} }`);
  assert.equal(m.resolve("n.Color")?.metaKind, MetaKind.Taxonomy);
  assert.deepEqual(m.related("n.Color", EdgeKind.Represents, Direction.Out), ["n.Hue"]);
  const red = m.resolve("n.Color.Red");
  assert.equal(red?.tier, Tier.Instance);
  assert.equal(red?.type, "n.Hue");
  assert.equal(red?.isClass, true);
  assert.equal(red?.attrs.get("label"), "Red");
  assert.deepEqual(m.narrowerOf("n.Color.Red"), []);
});

test("a multi-representation taxonomy types each term by its own concept", () => {
  const { model: m, diagnostics } = loadResult(
    `concept Location {} concept Technology {}
     taxonomy Microsoft : represents Location, Technology {
       Location azure          { label = "Azure"; }
       Technology azureOpenai { label = "Azure OpenAI"; }
     }`,
  );
  assert.equal(diagnostics.length, 0);
  // Both concepts are represented.
  assert.deepEqual(m.related("n.Microsoft", EdgeKind.Represents, Direction.Out).sort(), ["n.Location", "n.Technology"]);
  assert.deepEqual(m.represents("n.Microsoft").sort(), ["n.Location", "n.Technology"]);
  // Each term is a qualified, Instance-tier class of its own concept.
  const azure = m.resolve("n.Microsoft.azure");
  assert.equal(azure?.type, "n.Location");
  assert.equal(azure?.isClass, true);
  assert.equal(azure?.localId, "azure");
  assert.equal(m.resolve("n.Microsoft.azureOpenai")?.type, "n.Technology");
  // Both are Contains-members of the taxonomy.
  assert.deepEqual(m.termsOf("n.Microsoft").sort(), ["n.Microsoft.azure", "n.Microsoft.azureOpenai"]);
});

test("term relationship assignments (refs and lists) load as edges, scalars as attrs", () => {
  const m = repo(
    `concept Location { parent : Location?; } concept Technology { availableIn : Location[]; }
     taxonomy Microsoft : represents Location, Technology {
       Location azure { label = "Azure"; }
       Location m365  { parent = Microsoft.azure; }
       Technology graph { availableIn = [Microsoft.m365, Microsoft.azure]; }
     }`,
  );
  assert.equal(m.resolve("n.Microsoft.azure")?.attrs.get("label"), "Azure");
  assert.deepEqual(m.related("n.Microsoft.m365", EdgeKind.Relationship, Direction.Out, "parent"), ["n.Microsoft.azure"]);
  assert.deepEqual(
    m.related("n.Microsoft.graph", EdgeKind.Relationship, Direction.Out, "availableIn").sort(),
    ["n.Microsoft.azure", "n.Microsoft.m365"],
  );
});

test("a term composes a represented-concept record, bound to its field (not a term)", () => {
  const { model: m, diagnostics } = loadResult(
    `concept Billing { id : identifier; perCall : string?; }
     concept Technology { billing : Billing?; }
     taxonomy Microsoft : represents Technology, Billing {
       Technology azureOpenai { label = "AO"; Billing azureOpenaiBilling { perCall = "consumption"; } }
     }`,
  );
  assert.equal(diagnostics.filter((d) => d.code === DiagnosticCode.TermConceptNotRepresented).length, 0);
  assert.equal(m.resolve("n.Microsoft.azureOpenaiBilling")?.type, "n.Billing");
  assert.equal(m.resolve("n.Microsoft.azureOpenaiBilling")?.isClass, true);
  assert.deepEqual(
    m.related("n.Microsoft.azureOpenai", EdgeKind.Relationship, Direction.Out, "billing"),
    ["n.Microsoft.azureOpenaiBilling"],
  );
  // The composition record is bound to the term, not a member of the taxonomy.
  assert.ok(!m.termsOf("n.Microsoft").includes("n.Microsoft.azureOpenaiBilling"));
});

test("a term composing a non-represented concept is a load error", () => {
  const { diagnostics } = loadResult(
    `concept Billing { id : identifier; } concept Technology { billing : Billing?; }
     taxonomy Microsoft : represents Technology {
       Technology azureOpenai { Billing azureOpenaiBilling {} }
     }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TermConceptNotRepresented));
});

test("a bare `term` under a multi-concept taxonomy is flagged ambiguous", () => {
  const { diagnostics } = loadResult(
    `concept Location {} concept Technology {}
     taxonomy Microsoft : represents Location, Technology { term Azure {} }`,
  );
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.TaxonomyTermConceptAmbiguous));
});

test("a nested taxonomy loads Narrower edges and answers branch queries", () => {
  const m = repo(`concept C {} taxonomy Cc : represents C { term Surface { term ApiService {} term WebPortal {} } term DataStore {} }`);
  assert.deepEqual(m.narrowerOf("n.Cc.Surface").sort(), ["n.Cc.ApiService", "n.Cc.WebPortal"]);
  assert.deepEqual(m.broaderOf("n.Cc.ApiService"), ["n.Cc.Surface"]);
  assert.deepEqual(m.descendantsOf("n.Cc.Surface").sort(), ["n.Cc.ApiService", "n.Cc.WebPortal"]);
});

test("a class and its instanceof leaf load with InstanceOf wiring", () => {
  const m = repo(`concept Component {} class Component teamsChat {} Component chatHq instanceof teamsChat {}`);
  assert.equal(m.resolve("n.teamsChat")?.isClass, true);
  assert.equal(m.resolve("n.chatHq")?.isClass, false);
  assert.deepEqual(m.related("n.chatHq", EdgeKind.InstanceOf, Direction.Out), ["n.teamsChat"]);
});
