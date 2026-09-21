import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../parse/loader.js";
import { toJSON, fromJSON } from "../json.js";
import { MetaKind } from "../../model/kinds.js";

test("toJSON/fromJSON round-trips a nested taxonomy including Narrower edges", () => {
  const src = `namespace n { concept Thing {} taxonomy Cc : represents Thing { term Surface { term ApiService {} } term DataStore {} } }`;
  const original = load([{ uri: "t.todl", text: src }]).model;
  const rebuilt = fromJSON(toJSON(original));
  assert.deepEqual(rebuilt.narrowerOf("Cc.Surface"), ["Cc.ApiService"]);
  assert.deepEqual(rebuilt.broaderOf("Cc.ApiService"), ["Cc.Surface"]);
  assert.equal(rebuilt.resolve("Cc")?.metaKind, MetaKind.Taxonomy);
});
