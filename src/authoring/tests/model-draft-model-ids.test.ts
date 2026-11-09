import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { MetaKind } from "../../compiler-services/model/kinds.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { Severity } from "../../compiler-services/diagnostics/diagnostic.js";
import { ModelDraft } from "../model-draft.js";

/** One namespace `shop` with two models, M (c1 Ada) and N (c2 Bo), each in its own file, plus one file holding both. */
class ModelIdsFx
{
  static readonly Namespace = "shop";
  static readonly SchemaUri = "schema.todl";
  static readonly Schema = "namespace shop {\n  concept Customer { name : string?; }\n}\n";
  static readonly FileM = { uri: "m.todl", text: "namespace shop {\n  model M : shop {\n    Customer c1 { name = \"Ada\"; }\n  }\n}\n" };
  static readonly FileN = { uri: "n.todl", text: "namespace shop {\n  model N : shop {\n    Customer c2 { name = \"Bo\"; }\n  }\n}\n" };
  static readonly Both = { uri: "both.todl", text: "namespace shop {\n  model M : shop {\n    Customer c1 { name = \"Ada\"; }\n  }\n  model N : shop {\n    Customer c2 { name = \"Bo\"; }\n  }\n}\n" };
  static readonly C1 = "shop.c1";
  static readonly C2 = "shop.c2";
  static readonly C3 = "shop.c3";
  static readonly Customer = "shop.Customer";
  static readonly Name = "name";
  static readonly ModelM = "shop.M";
  static readonly ModelN = "shop.N";
  static readonly Contains = "Contains";

  static Base()
  {
    return check([{ uri: ModelIdsFx.SchemaUri, text: ModelIdsFx.Schema }]).model;
  }

  /** Recompiles the emitted files with the schema: the model each instance lands in, and the error codes. */
  static Recompile(files: ReadonlyMap<string, string>): { models: Map<string, string>; errors: string[] }
  {
    const result = check([{ uri: ModelIdsFx.SchemaUri, text: ModelIdsFx.Schema }, ...[...files].map(([uri, text]) => ({ uri, text }))]);
    const doc = toJSON(result.model);
    const modelIds = new Set(doc.nodes.filter((n) => n.metaKind === MetaKind.Model).map((n) => n.id));
    const models = new Map<string, string>();
    for (const e of doc.edges) if (e.kind === ModelIdsFx.Contains && modelIds.has(String(e.from))) models.set(String(e.to), String(e.from));
    return { models, errors: result.diagnostics.filter((d) => d.severity === Severity.Error).map((d) => d.code) };
  }
}

test("a re-emit keeps each model's declared id: two models of one namespace in two files", () => {
  const draft = ModelDraft.fromSources([ModelIdsFx.Base()], [ModelIdsFx.FileM, ModelIdsFx.FileN], { namespace: ModelIdsFx.Namespace });
  draft.setField(ModelIdsFx.C1, ModelIdsFx.Name, "Ann");
  draft.setField(ModelIdsFx.C2, ModelIdsFx.Name, "Bea");
  const files = draft.toTodlByFile();
  assert.match(files.get(ModelIdsFx.FileM.uri)!, /model M : shop/);
  assert.match(files.get(ModelIdsFx.FileN.uri)!, /model N : shop/);
  const { models, errors } = ModelIdsFx.Recompile(files);
  assert.deepEqual(errors, []);
  assert.equal(models.get(ModelIdsFx.C1), ModelIdsFx.ModelM);
  assert.equal(models.get(ModelIdsFx.C2), ModelIdsFx.ModelN);
});

test("a re-emit keeps both models of a file that declares two", () => {
  const draft = ModelDraft.fromSources([ModelIdsFx.Base()], [ModelIdsFx.Both], { namespace: ModelIdsFx.Namespace });
  draft.setField(ModelIdsFx.C1, ModelIdsFx.Name, "Ann");
  draft.setField(ModelIdsFx.C2, ModelIdsFx.Name, "Bea");
  const files = draft.toTodlByFile();
  const { models, errors } = ModelIdsFx.Recompile(files);
  assert.deepEqual(errors, []);
  assert.equal(models.get(ModelIdsFx.C1), ModelIdsFx.ModelM);
  assert.equal(models.get(ModelIdsFx.C2), ModelIdsFx.ModelN);
  assert.equal(draft.toTodl(), files.get(ModelIdsFx.Both.uri));
});

test("a created instance joins the draft's model, in the file declaring it", () => {
  const draft = ModelDraft.fromSources([ModelIdsFx.Base()], [ModelIdsFx.FileM, ModelIdsFx.FileN], { namespace: ModelIdsFx.Namespace, model: ModelIdsFx.ModelN });
  draft.create(ModelIdsFx.Customer, ModelIdsFx.C3);
  assert.equal(draft.homeOf(ModelIdsFx.C3), ModelIdsFx.FileN.uri);
  const { models, errors } = ModelIdsFx.Recompile(draft.toTodlByFile());
  assert.deepEqual(errors, []);
  assert.equal(models.get(ModelIdsFx.C3), ModelIdsFx.ModelN);
});

test("restore drops the model of an instance created after the snapshot", () => {
  const draft = ModelDraft.fromSources([ModelIdsFx.Base()], [ModelIdsFx.FileM], { namespace: ModelIdsFx.Namespace, model: ModelIdsFx.ModelM });
  const state = draft.Snapshot();
  draft.create(ModelIdsFx.Customer, ModelIdsFx.C3);
  draft.Restore(state);
  assert.equal(draft.Owns(ModelIdsFx.C3), false);
  assert.equal(draft.Snapshot().models.has(ModelIdsFx.C3), false);
});
