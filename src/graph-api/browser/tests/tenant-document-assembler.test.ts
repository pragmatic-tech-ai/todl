import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { compilePackage } from "../../../publish/publish.js";
import { GenericModelDataSource } from "../../../model-data/generic-model-data-source.js";
import { RemoteTenantConnector } from "../remote-tenant-connector.js";
import { TenantDocumentAssembler, type TenantNodeCell } from "../tenant-document-assembler.js";
import { TodlAppBootstrap } from "../todl-app-bootstrap.js";

const Source =
    `namespace acme { concept Svc { label : string?; uses : Svc?; } model M : acme { Svc a1 { label = "A1"; } Svc a2 { label = "x"; uses = a1; } } }`;

class Fixture
{
    public static Full()
    {
        const outcome = compilePackage([], [{ uri: "model.todl", text: Source }], { id: "my-arch", version: "0.1.0" });
        assert.ok(outcome.ok && outcome.package, JSON.stringify(outcome.diagnostics));
        return outcome.package!.fullDocument;
    }

    public static Cells(): TenantNodeCell[]
    {
        return [
            { id: "acme.a1", concept: "Svc", fields: { label: { value: "A1" } }, refs: {} },
            { id: "acme.a2", concept: "acme.Svc", fields: { label: { value: "live" } }, refs: { uses: ["acme.a1"] } },
        ];
    }
}

describe("TenantDocumentAssembler", () =>
{
    test("SchemaOf keeps ontology + model node and drops instances", () =>
    {
        const schema = TenantDocumentAssembler.SchemaOf(Fixture.Full());
        assert.ok(schema.nodes.some(n => n.id === "acme.Svc"));
        assert.ok(schema.nodes.some(n => n.metaKind === "model"));
        assert.ok(!schema.nodes.some(n => n.id === "acme.a1"));
    });

    test("Assemble adds live instances, containment and relationship edges", () =>
    {
        const doc = TenantDocumentAssembler.Assemble(TenantDocumentAssembler.SchemaOf(Fixture.Full()), Fixture.Cells());
        const a2 = doc.nodes.find(n => n.id === "acme.a2")!;
        assert.equal(a2.type, "acme.Svc");
        assert.equal(a2.attrs.label, "live");
        assert.ok(doc.edges.some(e => e.kind === "Contains" && e.to === "acme.a2"));
        assert.ok(doc.edges.some(e => e.kind === "Relationship" && e.via === "uses" && e.from === "acme.a2" && e.to === "acme.a1"));
    });

    test("Assemble skips cells of unknown concepts and IsNodeCell rejects non-nodes", () =>
    {
        const schema = TenantDocumentAssembler.SchemaOf(Fixture.Full());
        const doc = TenantDocumentAssembler.Assemble(schema, [{ id: "z.q", concept: "Nope", fields: {}, refs: {} }]);
        assert.ok(!doc.nodes.some(n => n.id === "z.q"));
        assert.equal(TenantDocumentAssembler.IsNodeCell(5), false);
        assert.equal(TenantDocumentAssembler.IsNodeCell(null), false);
        assert.equal(TenantDocumentAssembler.IsNodeCell(Fixture.Cells()[0]), true);
    });

    test("the assembled document loads into a ModelDataSource through RemoteTenantConnector", async () =>
    {
        const schema = TenantDocumentAssembler.SchemaOf(Fixture.Full());
        const client = { ReadDocument: async () => TenantDocumentAssembler.Assemble(schema, Fixture.Cells()) };
        const source = new GenericModelDataSource("my-arch", new RemoteTenantConnector(client));
        await source.Prepare({} as IServiceProvider);
        assert.equal(source.Instances("acme.Svc").length, 2);
    });

    test("Assemble drops a ref to an unknown target so a dangling edge never fails the whole load", async () =>
    {
        const schema = TenantDocumentAssembler.SchemaOf(Fixture.Full());
        const cells: TenantNodeCell[] = [
            { id: "acme.a1", concept: "acme.Svc", fields: { label: { value: "A1" } }, refs: { uses: ["acme.ghost"] } },
        ];
        const doc = TenantDocumentAssembler.Assemble(schema, cells);
        assert.ok(!doc.edges.some(e => e.to === "acme.ghost"), "the dangling ref edge is not emitted");
        const source = new GenericModelDataSource("my-arch", new RemoteTenantConnector({ ReadDocument: async () => doc }));
        await source.Prepare({} as IServiceProvider); // must not throw on the dropped dangling ref
        assert.equal(source.Instances("acme.Svc").length, 1);
    });

    test("Assemble does not wire relationship edges from a cell whose id collides with a schema node", () =>
    {
        const schema = TenantDocumentAssembler.SchemaOf(Fixture.Full());
        const cells: TenantNodeCell[] = [
            { id: "acme.a1", concept: "acme.Svc", fields: {}, refs: {} },
            { id: "acme.Svc", concept: "acme.Svc", fields: {}, refs: { uses: ["acme.a1"] } },
        ];
        const doc = TenantDocumentAssembler.Assemble(schema, cells);
        assert.ok(!doc.edges.some(e => e.kind === "Relationship" && e.from === "acme.Svc"), "no ref edge originates from the colliding schema node");
    });
});

describe("TodlAppBootstrap.PrepareAndMount", () =>
{
    test("awaits Prepare, then runs beforeMount, in that order", async () =>
    {
        const order: string[] = [];
        const services = {};
        const app = { Services: services, initialize: () => { order.push("init"); } } as never;
        const model = { Prepare: async (s: unknown) => { assert.equal(s, services); order.push("prepare"); } };
        await TodlAppBootstrap.PrepareAndMount(app, model as never, () => { order.push("before"); });
        assert.deepEqual(order, ["prepare", "before"]); // Mount is inert without a DOM
    });

    test("a failed Prepare rejects and does not run beforeMount", async () =>
    {
        let ran = false;
        const app = { Services: {}, initialize: () => undefined } as never;
        const model = { Prepare: async () => { throw new Error("boom"); } };
        await assert.rejects(() => TodlAppBootstrap.PrepareAndMount(app, model as never, () => { ran = true; }), /boom/);
        assert.equal(ran, false);
    });
});
