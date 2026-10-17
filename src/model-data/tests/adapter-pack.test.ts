import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind } from "../connector-plan.js";
import type { AdapterResolutionRequest } from "../data-source-adapter.js";
import { AdapterPack, AdapterPackContract } from "../adapter-pack.js";
import type { IAdapterPack } from "../adapter-pack.js";
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
    const pack: IAdapterPack = { Factories: () => [factory] };
    assert.deepEqual(pack.Factories(), [factory]);
});

test("AdapterPack.Of exposes the given factories in order", () =>
{
    const a = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const b = new InMemoryAdapterFactory(DataSourceKind.Rest);
    assert.deepEqual(AdapterPack.Of(a, b).Factories(), [a, b]);
});

test("the SDK is reachable from the @pragmatic-tech-ai/todl/adapter-pack subpath", async () =>
{
    const mod = await import("@pragmatic-tech-ai/todl/adapter-pack");
    const a = new InMemoryAdapterFactory(DataSourceKind.Sql);
    assert.deepEqual(mod.AdapterPack.Of(a).Factories(), [a]);
    assert.equal(mod.AdapterPackContract.ManifestKey, "adapterPack");
    assert.equal(mod.AdapterPackContract.AbiVersion, "1");
});
