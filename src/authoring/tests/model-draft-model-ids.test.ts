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

/** A meta-model with two viewpoints, and files whose two models conform to different ones. */
class ViewpointsFx
{
  static readonly MetaUri = "mm.todl";
  static readonly Meta = "namespace mm {\n  concept Component {}\n  concept Node {}\n  viewpoint V1 : frames Component\n  viewpoint V2 : frames Node\n}\n";
  static readonly Namespace = "acme";
  static readonly Both = { uri: "both.todl", text: "namespace acme {\n  import mm;\n  model M : mm conforms V1 { Component web {} }\n  model N : mm conforms V2 { Node host {} }\n}\n" };
  static readonly WithSchema = { uri: "schema-and-models.todl", text: "namespace acme {\n  import mm;\n  concept Local {}\n  model M : mm conforms V1 { Component web {} }\n  model N : mm conforms V2 { Node host {} }\n}\n" };
  static readonly Web = "acme.web";
  static readonly Host = "acme.host";
  static readonly Api = "acme.api";
  static readonly Box = "acme.box";
  static readonly Component = "mm.Component";
  static readonly Node = "mm.Node";
  static readonly Label = "label";
  static readonly WebLabel = "w";
  static readonly HostLabel = "h";
  static readonly Edited = [/label = "w"/, /label = "h"/];
  static readonly ModelM = "acme.M";
  static readonly ModelN = "acme.N";
  static readonly BlockM = /model M : mm[^{]*conforms (mm\.)?V1 \{/;
  static readonly BlockN = /model N : mm[^{]*conforms (mm\.)?V2 \{/;
  static readonly LocalConcept = /concept Local \{\}/;

  static Base()
  {
    return check([{ uri: ViewpointsFx.MetaUri, text: ViewpointsFx.Meta }]).model;
  }

  /** The error codes of the emitted files compiled with the meta-model, and where each instance landed. */
  static Recompile(files: ReadonlyMap<string, string>): { errors: string[]; models: Map<string, string> }
  {
    const result = check([{ uri: ViewpointsFx.MetaUri, text: ViewpointsFx.Meta }, ...[...files].map(([uri, text]) => ({ uri, text }))]);
    const doc = toJSON(result.model);
    const modelIds = new Set(doc.nodes.filter((n) => n.metaKind === MetaKind.Model).map((n) => n.id));
    const models = new Map<string, string>();
    for (const e of doc.edges) if (e.kind === ModelIdsFx.Contains && modelIds.has(String(e.from))) models.set(String(e.to), String(e.from));
    return { errors: result.diagnostics.filter((d) => d.severity === Severity.Error).map((d) => d.code), models };
  }
}

test("two models of one file keep their own conforms viewpoints on re-emit", () => {
  const draft = ModelDraft.fromSources([ViewpointsFx.Base()], [ViewpointsFx.Both], { namespace: ViewpointsFx.Namespace });
  draft.setField(ViewpointsFx.Web, ViewpointsFx.Label, ViewpointsFx.WebLabel);
  draft.setField(ViewpointsFx.Host, ViewpointsFx.Label, ViewpointsFx.HostLabel);
  draft.create(ViewpointsFx.Component, ViewpointsFx.Api, ViewpointsFx.Both.uri);
  const state = draft.Snapshot();
  draft.Restore(state);
  const files = draft.toTodlByFile();
  const text = files.get(ViewpointsFx.Both.uri)!;
  assert.match(text, ViewpointsFx.BlockM);
  assert.match(text, ViewpointsFx.BlockN);
  const { errors, models } = ViewpointsFx.Recompile(files);
  assert.deepEqual(errors, []);
  assert.equal(models.get(ViewpointsFx.Web), ViewpointsFx.ModelM);
  assert.equal(models.get(ViewpointsFx.Host), ViewpointsFx.ModelN);
  assert.equal(models.get(ViewpointsFx.Api), ViewpointsFx.ModelM);
  for (const edit of ViewpointsFx.Edited) assert.match(text, edit);
});

test("a file with schema and two model blocks splices each block's body and keeps the schema", () => {
  const draft = ModelDraft.fromSources([ViewpointsFx.Base()], [ViewpointsFx.WithSchema], { namespace: ViewpointsFx.Namespace, model: ViewpointsFx.ModelN });
  draft.setField(ViewpointsFx.Web, ViewpointsFx.Label, ViewpointsFx.WebLabel);
  draft.setField(ViewpointsFx.Host, ViewpointsFx.Label, ViewpointsFx.HostLabel);
  draft.create(ViewpointsFx.Node, ViewpointsFx.Box);
  const files = draft.toTodlByFile();
  const text = files.get(ViewpointsFx.WithSchema.uri)!;
  assert.match(text, ViewpointsFx.LocalConcept);
  assert.match(text, ViewpointsFx.BlockM);
  assert.match(text, ViewpointsFx.BlockN);
  const { errors, models } = ViewpointsFx.Recompile(files);
  assert.deepEqual(errors, []);
  assert.equal(models.get(ViewpointsFx.Web), ViewpointsFx.ModelM);
  assert.equal(models.get(ViewpointsFx.Host), ViewpointsFx.ModelN);
  assert.equal(models.get(ViewpointsFx.Box), ViewpointsFx.ModelN);
  for (const edit of ViewpointsFx.Edited) assert.match(text, edit);
});
