import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { PopulationBuilder } from "../population-builder.js";
import { ConnectorResolutionStep } from "../connector-resolution-step.js";
import { WriteConcurrency, WriteAtomicity } from "../connector-plan.js";
import type { ConnectorBinding } from "../connector-plan.js";

const META = `namespace shop
{
    concept Customer { customer_id : string; email : string; phone : string; }
    identity Customer key storageId;
    merge Customer { prefer source "opsdb.contacts" for email; prefer source "opsdb.crm_accounts" for phone; }
}`;

function binding(source: string): ConnectorBinding
{
    return { Concept: "shop.Customer", Connector: "opsdb", Source: source, IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email", phone: "phone" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
}

test("resolves two sources of one entity into a single collapsed canonical with fan-out targets", () =>
{
    const base = toJSON(check([{ uri: "shop.todl", text: META }]).model);
    const builder = new PopulationBuilder(base);
    builder.Add(binding("contacts"), [{ customer_id: "C1", email: "new@acme.com", phone: "555-NEW" }]);
    builder.Add(binding("crm_accounts"), [{ customer_id: "C1", email: "old@acme.com", phone: "555-OLD" }]);

    const result = new ConnectorResolutionStep().Resolve(builder.Build(), builder.Sources());

    const instances = result.document.nodes.filter((n) => n.type === "shop.Customer" && n.tier === "Instance");
    assert.equal(instances.length, 1, "aliases collapsed to one canonical");
    const canonical = instances[0]!;

    const targets = result.writeTargets.get(canonical.id);
    assert.ok(targets !== undefined);
    assert.equal(targets!.length, 2);
    assert.deepEqual([...targets!].map((t) => t.Source).sort(), ["contacts", "crm_accounts"]);
    for (const t of targets!) assert.equal(t.StorageId, "C1");

    const emailDecision = result.decisions.find((d) => d.member === "email");
    assert.equal(emailDecision!.source, "opsdb.contacts");
    assert.equal(result.diagnostics.length, 0);
});
