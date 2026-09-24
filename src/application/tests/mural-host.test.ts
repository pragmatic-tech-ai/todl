import { test } from "node:test";
import assert from "node:assert/strict";
import { Application, type ApplicationInitOptions } from "@pragmatic-tech-ai/mural";
import { Material, MaterialLight } from "@pragmatic-tech-ai/mural/resources/material";
import { HeadlessTarget, SvgDrawingContext } from "@pragmatic-tech-ai/mural/visual-engine";
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
import { ConceptHeaderVM, InstanceRowVM, ModelBrowserVM } from "../model-browser-vm.js";
import { AppRegistry } from "../../codegen/tests/fixtures/demo-app.package.generated.js";

class Probe extends ModelDataSource
{
    constructor(connector?: IModelDataConnector) { super(connector); this.modelName = "probe"; this.modelVersion = "0.0.0"; }
}

class Fixtures
{
    public static readonly Theme: ApplicationInitOptions = { theme: Material, scheme: MaterialLight };

    public static WidgetDoc(id: string): TodlDocument
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

    public static RegistryWith(): ModelRegistry
    {
        const reg = new ModelRegistry();
        reg.Register("a", new Probe(new BundledModelDataConnector(Fixtures.WidgetDoc("wa"))));
        reg.SetRoot("a");
        return reg;
    }

    public static Labels(vm: ModelBrowserVM): string[]
    {
        return vm.Rows.ToArray().map((row) =>
        {
            if (row instanceof ConceptHeaderVM) return row.Concept;
            if (row instanceof InstanceRowVM) return row.Text;
            return "";
        });
    }
}

test("MuralViewContribution installs a themed root visual with a ModelBrowserVM DataContext", async () =>
{
    const app = new Application();
    app.initialize(Fixtures.Theme);
    await ApplicationBootstrapper.Boot([new ModelRegistryContribution(Fixtures.RegistryWith()), new MuralViewContribution()], app);
    assert.notEqual(app.Resources.Root, undefined);
    assert.ok(app.Resources.Root!.DataContext instanceof ModelBrowserVM);
});

test("MuralViewContribution throws on a non-Application composition root", () =>
{
    assert.throws(() => new MuralViewContribution().Contribute(new CompositionRoot()), /Mural|Application/);
});

test("MuralHost.Run builds a ModelBrowserVM over the root model's instances", async () =>
{
    const { app } = await MuralHost.Run(AppRegistry.Create(), Fixtures.Theme);
    const vm = app.Resources.Root!.DataContext as ModelBrowserVM;
    const labels = Fixtures.Labels(vm);
    assert.ok(labels.includes("service"), `expected concept "service" in ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("api"), 'expected instance id "api"');
});

test("the mounted view paints headlessly without throwing", async () =>
{
    const { app } = await MuralHost.Run(AppRegistry.Create(), Fixtures.Theme);
    const target = new HeadlessTarget(400, 300);
    target.Content = app.Resources.Root;   // mount (production uses app.initialize(target))
    const dc = new SvgDrawingContext();
    target.Render(dc);
    assert.ok(dc.ToFragment().length > 0, "expected a non-empty SVG fragment");
});
