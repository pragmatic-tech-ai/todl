import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";

function repo(text: string)
{
  return load([{ uri: "t.todl", text: `namespace n {\n${text}\n}` }]).model;
}

test("isClass / classOf / instancesOfClass over instanceof", () => {
  const m = repo(
    `concept Component {} class Component teamsChat {} Component a instanceof teamsChat {} Component b instanceof teamsChat {}`,
  );
  assert.equal(m.isClass("n.teamsChat"), true);
  assert.equal(m.isClass("n.a"), false);
  assert.equal(m.classOf("n.a"), "n.teamsChat");
  assert.equal(m.classOf("n.teamsChat"), null);
  assert.deepEqual(m.instancesOfClass("n.teamsChat").sort(), ["n.a", "n.b"]);
});

test("represents / representedBy / termsOf over a taxonomy", () => {
  const m = repo(
    `concept Category { icon : string; } taxonomy ComponentCategory : represents Category { term ConversationalInterface { icon = "chat.svg"; } term WebPortal {} }`,
  );
  assert.deepEqual(m.represents("n.ComponentCategory"), ["n.Category"]);
  assert.deepEqual(m.representedBy("n.Category"), ["n.ComponentCategory"]);
  assert.deepEqual(m.termsOf("n.ComponentCategory").sort(), [
    "n.ComponentCategory.ConversationalInterface",
    "n.ComponentCategory.WebPortal",
  ]);
});

test("effectiveFields merges class-fixed values with leaf fills", () => {
  const m = repo(
    `concept Component { realisedBy : string; region : string; } class Component teamsChat { realisedBy = "teams"; } Component hq instanceof teamsChat { region = "eu"; }`,
  );
  const eff = m.effectiveFields("n.hq");
  assert.equal(eff.get("realisedBy"), "teams"); // inherited, fixed
  assert.equal(eff.get("region"), "eu"); // leaf fill
  assert.equal(eff.get("class"), undefined); // marker not leaked
});
