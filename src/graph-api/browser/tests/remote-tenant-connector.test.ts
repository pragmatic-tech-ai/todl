import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import {
    RemoteTenantConnector,
    RemoteWriteUnsupportedError,
    type ITenantReadClient,
} from "../remote-tenant-connector.js";
import { ServableManifest } from "../../../solution-services/todl-build-system/html-bundle/servable-manifest.js";

class FakeClient implements ITenantReadClient
{
    public Calls = 0;

    constructor(private readonly doc: TodlDocument)
    {
    }

    public ReadDocument(): Promise<TodlDocument>
    {
        this.Calls++;
        return Promise.resolve(this.doc);
    }
}

const NoServices = {} as IServiceProvider;

test("RemoteTenantConnector.Prepare resolves the document through the client, once", async () =>
{
    const doc: TodlDocument = { nodes: [], edges: [] };
    const client = new FakeClient(doc);
    const connector = new RemoteTenantConnector(client);
    assert.equal(await connector.Prepare(NoServices), doc);
    assert.equal(await connector.Prepare(NoServices), doc);
    assert.equal(client.Calls, 1);
});

test("RemoteTenantConnector.Refresh re-reads from the client", async () =>
{
    const client = new FakeClient({ nodes: [], edges: [] });
    const connector = new RemoteTenantConnector(client);
    await connector.Prepare(NoServices);
    await connector.Refresh(NoServices);
    assert.equal(client.Calls, 2);
});

test("RemoteTenantConnector.Apply throws RemoteWriteUnsupportedError", () =>
{
    const connector = new RemoteTenantConnector(new FakeClient({ nodes: [], edges: [] }));
    assert.throws(() => connector.Apply(), (e: unknown) =>
        e instanceof RemoteWriteUnsupportedError && /SP1/.test(e.message));
});

test("connector source imports nothing from protocol/server/identity", () =>
{
    const src = readFileSync(new URL("../remote-tenant-connector.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*(pragmatic-protocol|server|identity)/);
});

test("ServableManifest.For produces the exact shape", () =>
{
    const m = ServableManifest.For("app", "1.0.0", [{ id: "p", version: "2" }], "main.js", ["a.css"]);
    assert.deepEqual(m, {
        name: "app",
        version: "1.0.0",
        packages: [{ id: "p", version: "2" }],
        ui: { entry: "main.js", assets: ["a.css"] },
    });
});
