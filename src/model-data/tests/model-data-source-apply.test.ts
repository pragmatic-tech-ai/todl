import { test } from "node:test";
import assert from "node:assert/strict";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../model-data-source.js";
import type { IModelDataConnector } from "../model-data-connector.js";
import { ConnectorWriteOpKind, ConnectorWriteStatus } from "../connector-write-op.js";
import type { ConnectorWriteOp, ConnectorWriteResult } from "../connector-write-op.js";

class FakeConnector implements IModelDataConnector
{
    public LastOps: readonly ConnectorWriteOp[] = [];
    public PrepareCount = 0;
    public RefreshCount = 0;

    public async Prepare(_services: IServiceProvider): Promise<TodlDocument>
    {
        this.PrepareCount += 1;
        return { nodes: [], edges: [] };
    }

    public async Refresh(_services: IServiceProvider): Promise<TodlDocument>
    {
        this.RefreshCount += 1;
        return { nodes: [], edges: [] };
    }

    public async Apply(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>
    {
        this.LastOps = ops;
        return { Results: [{ Status: ConnectorWriteStatus.Applied, Id: "x" }] };
    }
}

class TestSource extends ModelDataSource
{
    public constructor(connector: IModelDataConnector)
    {
        super(connector);
    }
}

test("Apply delegates ops to the connector then re-reads", async () =>
{
    const connector = new FakeConnector();
    const source = new TestSource(connector);
    await source.Prepare({} as IServiceProvider);
    let changed = 0;
    source.DataChanged.subscribe(() => { changed += 1; });
    const result = await source.Apply([{ Kind: ConnectorWriteOpKind.Create, Concept: "acme.Svc", Fields: { label: "A" } }]);
    assert.equal(connector.LastOps.length, 1);
    assert.equal(result.Results[0]?.Status, ConnectorWriteStatus.Applied);
    assert.equal(connector.RefreshCount, 1);
    assert.equal(changed, 1);
});

test("Apply throws a clear error when the connector is write-incapable", async () =>
{
    const source = new TestSource({ Prepare: async () => ({ nodes: [], edges: [] }) });
    await source.Prepare({} as IServiceProvider);
    await assert.rejects(() => source.Apply([]), /connector.*not.*support.*write/i);
});
