import { test } from "node:test";
import assert from "node:assert/strict";
import { CapturingPackageSource } from "../capturing-package-source.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import { Domain, type ResolvedPackage } from "../domain.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";

const DOC: TodlDocument = { nodes: [], edges: [] };

function pkg(model: string, version: string, withDoc: boolean): ResolvedPackage
{
    const r: ResolvedPackage = { ref: { model, version }, manifest: {} as never, dependencies: [] };
    if (withDoc) r.document = DOC;
    return r;
}

test("records the document of a resolved package under its identity", async () =>
{
    const inner = new MemoryPackageSource([pkg("acme.a", "1.0.0", true)]);
    const capturing = new CapturingPackageSource(inner);
    await capturing.resolve({ model: "acme.a", version: "1.0.0" });
    assert.equal(capturing.DocumentFor(Domain.identity({ model: "acme.a", version: "1.0.0" })), DOC);
});

test("records nothing when the resolved package has no document", async () =>
{
    const inner = new MemoryPackageSource([pkg("acme.a", "1.0.0", false)]);
    const capturing = new CapturingPackageSource(inner);
    await capturing.resolve({ model: "acme.a", version: "1.0.0" });
    assert.equal(capturing.DocumentFor(Domain.identity({ model: "acme.a", version: "1.0.0" })), undefined);
});

test("delegates versions to the inner source", async () =>
{
    const inner = new MemoryPackageSource([pkg("acme.a", "1.0.0", true)]);
    const capturing = new CapturingPackageSource(inner);
    assert.deepEqual(await capturing.versions("acme.a"), ["1.0.0"]);
});
