import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { DocumentModelDataConnector } from "../document-model-data-connector.js";

test("DocumentModelDataConnector.Prepare resolves to the wrapped document", async () =>
{
    const doc: TodlDocument = { nodes: [], edges: [] };
    const connector = new DocumentModelDataConnector(doc);
    const out = await connector.Prepare(new ServiceProvider());
    assert.equal(out, doc);
});
