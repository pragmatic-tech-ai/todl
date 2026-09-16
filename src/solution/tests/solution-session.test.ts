import { test } from "node:test";
import assert from "node:assert/strict";
import { SolutionSession } from "../solution-session.js";
import { PackageManifestBridge } from "../../package-manager/package-manifest-bridge.js";
import { compilePackage } from "../../publish/publish.js";
import type { PackageSource, PackageRef, ResolvedPackage } from "../../domain/domain.js";

// A fake PackageSource backed by an in-memory map of Domain ResolvedPackages.
class MapSource implements PackageSource {
  constructor(private readonly byId: Map<string, ResolvedPackage>) {}
  async resolve(ref: PackageRef): Promise<ResolvedPackage> {
    const r = this.byId.get(`${ref.model}@${ref.version}`);
    if (r === undefined) throw new Error(`unknown ${ref.model}@${ref.version}`);
    return r;
  }
}

function resolved(id: string, version: string): ResolvedPackage {
  const out = compilePackage(
    [],
    [{ uri: `${id}.todl`, text: `namespace acme { concept Widget { name : string; } }` }],
    { id, version },
  );
  return PackageManifestBridge.toResolved(out.package!);
}

test("compose loads members into one Domain with no diagnostics", async () => {
  const src = new MapSource(new Map([["acme.a@1.0.0", resolved("acme.a", "1.0.0")]]));
  const session = new SolutionSession(src);
  await session.compose([{ model: "acme.a", version: "1.0.0" }]);
  assert.deepEqual(session.Diagnostics, []);
  assert.notEqual(session.Domain.getManifest("acme.a"), undefined);
});

test("an unresolvable member yields one diagnostic, not a throw", async () => {
  const session = new SolutionSession(new MapSource(new Map()));
  await session.compose([{ model: "acme.missing", version: "1.0.0" }]);
  assert.equal(session.Diagnostics.length, 1);
  assert.match(session.Diagnostics[0]!.message, /acme\.missing/);
});
