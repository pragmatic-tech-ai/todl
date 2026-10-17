import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind } from "../connector-plan.js";
import type { AdapterResolutionRequest } from "../data-source-adapter.js";
import type { IAdapterPack as IAdapterPackFromModule } from "../adapter-pack.js";
import { RegisteredAdapterProvider, InMemoryAdapterFactory } from "./fakes.js";

test("a provider resolves a factory from an AdapterResolutionRequest by Kind", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Rest);
    const provider = new RegisteredAdapterProvider().Add(factory);
    const request: AdapterResolutionRequest = { Kind: DataSourceKind.Rest, Provider: "@x/rest@1.0.0" };
    assert.equal(await provider.Resolve(request), factory);
});

test("IAdapterPack exposes its factories", () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const pack: IAdapterPackFromModule = { Factories: () => [factory] };
    assert.deepEqual(pack.Factories(), [factory]);
});
