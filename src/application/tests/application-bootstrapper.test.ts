import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositionRoot, HostKind, ServiceKey, type IModule, type IServiceContainer } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import { ModelDataSource } from "../../model-data/model-data-source.js";
import { ModelRegistry } from "../../model-data/model-registry.js";
import { BundledModelDataConnector } from "../../model-data/bundled-model-data-connector.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import { ApplicationBootstrapper } from "../application-bootstrapper.js";
import { ModelRegistryContribution } from "../model-registry-contribution.js";
import type { IContributionSource } from "../contribution-source.js";

// A one-concept document with a single `widget` instance whose id is `instanceId`.
function widgetDoc(instanceId: string): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.assertInstance("widget", instanceId);
    b.setField(instanceId, "label", instanceId);
    b.commit();
    return toJSON(r);
}

// A minimal connector-backed source exposing the `widget` collection.
class MiniSource extends ModelDataSource
{
    constructor(connector?: IModelDataConnector)
    {
        super(connector);
        this.modelName = "mini";
        this.modelVersion = "0.0.0";
    }

    public widgets(): readonly ReflectedEntity[]
    {
        return this.instancesOf("widget");
    }
}

// Two connector-backed sources; model "a" (instance "wa") is the root, "b" ("wb") is not.
function registryWith(): ModelRegistry
{
    const reg = new ModelRegistry();
    reg.Register("a", new MiniSource(new BundledModelDataConnector(widgetDoc("wa"))));
    reg.Register("b", new MiniSource(new BundledModelDataConnector(widgetDoc("wb"))));
    reg.SetRoot("a");
    return reg;
}

// A connector that always fails — to prove boot rejects on preparation failure.
class FailingConnector implements IModelDataConnector
{
    public Prepare(): Promise<TodlDocument>
    {
        return Promise.reject(new Error("connector boom"));
    }
}

// A second contribution kind: composes a module that registers a marker service.
class MarkerModule implements IModule
{
    public static readonly Key = new ServiceKey<string>("Marker");
    public readonly Targets: ReadonlySet<HostKind> = new Set();

    public RegisterServices(container: IServiceContainer): void
    {
        container.registerInstance(MarkerModule.Key, "marker-value");
    }
}

class MarkerContribution implements IContributionSource
{
    public Contribute(root: CompositionRoot): void
    {
        root.AddModule(new MarkerModule());
    }
}

test("BootRegistry prepares every source and registers the registry under ServiceKey", async () =>
{
    const reg = registryWith();
    const entry = await ApplicationBootstrapper.BootRegistry(reg);
    assert.equal(entry.Services.getRequired(ModelRegistry.ServiceKey), reg);
    assert.deepEqual((entry.Root() as MiniSource).widgets().map((e) => e.id), ["wa"]);
});

test("Boot composes a host-supplied CompositionRoot (registry lands in that root)", async () =>
{
    const root = new CompositionRoot(new HostKind("Test"));
    const reg = registryWith();
    await ApplicationBootstrapper.Boot([new ModelRegistryContribution(reg)], root);
    assert.equal(root.Provider.getRequired(ModelRegistry.ServiceKey), reg);
});

test("an app booted with no ModelRegistryContribution throws a clear error", async () =>
{
    const entry = await ApplicationBootstrapper.Boot([]);
    assert.throws(() => entry.Registry(), /ModelRegistry/);
    assert.throws(() => entry.Root(), /ModelRegistry/);
});

test("Boot applies an arbitrary contribution list, not just the registry", async () =>
{
    const reg = registryWith();
    const entry = await ApplicationBootstrapper.Boot([new ModelRegistryContribution(reg), new MarkerContribution()]);
    assert.equal(entry.Services.getRequired(ModelRegistry.ServiceKey), reg);
    assert.equal(entry.Services.getRequired(MarkerModule.Key), "marker-value");
});

test("a failing connector makes Boot reject (no half-prepared entry point)", async () =>
{
    const reg = new ModelRegistry();
    reg.Register("a", new MiniSource(new FailingConnector()));
    reg.SetRoot("a");
    await assert.rejects(() => ApplicationBootstrapper.BootRegistry(reg), /boom/);
});

test("re-booting the same registry is idempotent and still readable", async () =>
{
    const reg = registryWith();
    await ApplicationBootstrapper.BootRegistry(reg);
    const entry = await ApplicationBootstrapper.BootRegistry(reg);
    assert.deepEqual((entry.Root() as MiniSource).widgets().map((e) => e.id), ["wa"]);
});
