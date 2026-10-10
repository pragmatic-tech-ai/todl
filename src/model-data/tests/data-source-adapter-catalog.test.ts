import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind } from "../connector-plan.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { InMemoryAdapter, InMemoryAdapterFactory, RegisteredAdapterProvider } from "./fakes.js";
import { describeDataSourceAdapter } from "./data-source-adapter-conformance.js";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";

describeDataSourceAdapter("InMemoryAdapter", () =>
{
    const a = new InMemoryAdapter();
    a.Seed("Customer", [{ id: "c1", label: "Acme" }]);
    return a;
});

test("catalog opens a registered factory and memoizes per connector name", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog();
    catalog.Register(factory);
    const services = new ServiceProvider();
    const spec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {}, Connection: "crm" };
    const first = await catalog.Open(spec, services);
    const second = await catalog.Open(spec, services);
    assert.equal(first, second);
});

test("catalog falls back to the provider when no factory is registered", async () =>
{
    const provider = new RegisteredAdapterProvider();
    provider.Add(new InMemoryAdapterFactory(DataSourceKind.Rest));
    const catalog = new DataSourceAdapterCatalog(provider);
    const opened = await catalog.Open({ Name: "api", Kind: DataSourceKind.Rest, Config: {} }, new ServiceProvider());
    assert.ok(opened);
});

test("catalog rejects an unresolvable kind with a connector diagnostic message", async () =>
{
    const catalog = new DataSourceAdapterCatalog();
    await assert.rejects(
        () => catalog.Open({ Name: "x", Kind: DataSourceKind.Document, Config: {} }, new ServiceProvider()),
        /connector/i,
    );
});
