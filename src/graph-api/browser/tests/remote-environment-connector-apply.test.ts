import { test } from "node:test";
import assert from "node:assert/strict";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import {
    ConnectorWriteOpKind,
    ConnectorWriteStatus,
    type ConnectorWriteOp,
    type ConnectorWriteResult,
} from "../../../model-data/connector-write-op.js";
import { RemoteEnvironmentConnector, RemoteWriteUnsupportedError, type IEnvironmentReadClient } from "../remote-environment-connector.js";
import type { IEnvironmentWriteClient } from "../environment-write-client.js";

class FakeReadWriteClient implements IEnvironmentReadClient, IEnvironmentWriteClient
{
    public LastOps: readonly ConnectorWriteOp[] = [];

    public ReadDocument(): Promise<TodlDocument>
    {
        return Promise.resolve({ nodes: [], edges: [] } as unknown as TodlDocument);
    }

    public WriteDocument(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>
    {
        this.LastOps = ops;
        return Promise.resolve({ Results: ops.map(o => (o.Id === undefined ? { Status: ConnectorWriteStatus.Applied } : { Status: ConnectorWriteStatus.Applied, Id: o.Id })) });
    }
}

test("Apply forwards to the write client", async () =>
{
    const client = new FakeReadWriteClient();
    const connector = new RemoteEnvironmentConnector(client, client);
    const result = await connector.Apply([{ Kind: ConnectorWriteOpKind.Delete, Concept: "acme.Svc", Id: "a1" }]);
    assert.equal(client.LastOps[0]?.Id, "a1");
    assert.equal(result.Results.length, 1);
    assert.equal(result.Results[0]?.Status, ConnectorWriteStatus.Applied);
});

test("Apply without a write client throws RemoteWriteUnsupportedError", async () =>
{
    const connector = new RemoteEnvironmentConnector(new FakeReadWriteClient());
    await assert.rejects(() => connector.Apply([]), RemoteWriteUnsupportedError);
});
