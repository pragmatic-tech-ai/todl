import { test } from "node:test";
import assert from "node:assert/strict";
import { Application, type Visual } from "@pragmatic-tech-ai/mural";
import { HeadlessTarget, SvgDrawingContext } from "@pragmatic-tech-ai/mural/visual-engine";
import { TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../../model-data/model-data-source.js";
import { ModelRegistry } from "../../model-data/model-registry.js";
import { BundledModelDataConnector } from "../../model-data/bundled-model-data-connector.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import { ApplicationBootstrapper } from "../application-bootstrapper.js";
import { ModelRegistryContribution } from "../model-registry-contribution.js";
import { MuralViewContribution } from "../mural-view-contribution.js";
import { MuralHost } from "../mural-host.js";
import { AppRegistry } from "../../codegen/tests/fixtures/demo-app.package.generated.js";

function widgetDoc(id: string): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.assertInstance("widget", id);
    b.setField(id, "label", id);
    b.commit();
    return toJSON(r);
}

class Probe extends ModelDataSource
{
    constructor(connector?: IModelDataConnector) { super(connector); this.modelName = "probe"; this.modelVersion = "0.0.0"; }
}

function registryWith(): ModelRegistry
{
    const reg = new ModelRegistry();
    reg.Register("a", new Probe(new BundledModelDataConnector(widgetDoc("wa"))));
    reg.SetRoot("a");
    return reg;
}

function allTexts(root: Visual): string[]
{
    const out: string[] = [];
    const walk = (v: Visual): void =>
    {
        if (v instanceof TextBlock) out.push(v.Text ?? "");
        for (const c of v.visualChildren) walk(c);
    };
    walk(root);
    return out;
}

test("MuralViewContribution sets Resources.Root to the built view", async () =>
{
    const app = new Application();
    await ApplicationBootstrapper.Boot([new ModelRegistryContribution(registryWith()), new MuralViewContribution()], app);
    assert.notEqual(app.Resources.Root, undefined);
});

test("MuralViewContribution throws on a non-Application composition root", () =>
{
    assert.throws(() => new MuralViewContribution().Contribute(new CompositionRoot()), /Mural|Application/);
});

test("MuralHost.Run boots a generated app and the view shows its instances", async () =>
{
    const { app } = await MuralHost.Run(AppRegistry.Create());
    const texts = allTexts(app.Resources.Root!);
    assert.ok(texts.includes("service"), `expected concept "service" in ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("api"), "expected instance id \"api\"");
});

test("the mounted view paints headlessly without throwing", async () =>
{
    const { app } = await MuralHost.Run(AppRegistry.Create());
    const target = new HeadlessTarget(400, 300);
    target.Content = app.Resources.Root;   // mount (production uses app.initialize(target))
    const dc = new SvgDrawingContext();
    target.Render(dc);
    assert.ok(dc.ToFragment().length > 0, "expected a non-empty SVG fragment");
});
