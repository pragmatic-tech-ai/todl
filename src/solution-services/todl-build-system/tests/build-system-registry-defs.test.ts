import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { BuildSystemRegistry } from "../../build-system-core/build-system-registry.js";
import type { CoreBuildContext, IBuildAction } from "../../build-system-core/build-action.js";
import type { IBuildSystem } from "../../build-system-core/build-system.js";
import { StaticBuildFlavor, type BuildFlavor } from "../../build-system-core/build-flavor.js";

interface FakeTarget
{
    type: string;
}

class FakeAction implements IBuildAction<CoreBuildContext>
{
    public readonly Consumes: readonly ArtifactKey<unknown>[];
    public readonly Produces: readonly ArtifactKey<unknown>[];

    constructor(
        public readonly Name: string,
        consumes: readonly ArtifactKey<unknown>[] = [],
        produces: readonly ArtifactKey<unknown>[] = [],
    )
    {
        this.Consumes = consumes;
        this.Produces = produces;
    }

    public Execute(_ctx: CoreBuildContext): Promise<void>
    {
        return Promise.resolve();
    }
}

class FakeSystem implements IBuildSystem<CoreBuildContext, FakeTarget>
{
    constructor(
        public readonly Id: string,
        private readonly actions: readonly IBuildAction<CoreBuildContext>[],
        private readonly appliesTo: string | undefined = undefined,
    )
    {
    }

    public get DisplayName(): string
    {
        return this.Id;
    }

    public AppliesTo(target: FakeTarget): boolean
    {
        return this.appliesTo === undefined || target.type === this.appliesTo;
    }

    public Flavors(): readonly BuildFlavor<CoreBuildContext>[]
    {
        return [new StaticBuildFlavor(this.Id, this.Id, this.Id, this.actions)];
    }
}

function targetOf(type: string): FakeTarget
{
    return { type };
}

describe("BuildSystemRegistry.RegisterResolved", () =>
{
    test("RegisterResolved accepts and stores a valid system", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const system = new FakeSystem("npm", []);
        registry.RegisterResolved(system);
        assert.equal(registry.Get("npm"), system);
    });

    test("RegisterResolved is idempotent — second call with same id returns without throwing", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const system1 = new FakeSystem("npm", []);
        const system2 = new FakeSystem("npm", []);
        registry.RegisterResolved(system1);
        registry.RegisterResolved(system2);
        // The first system should still be in the registry (not replaced).
        assert.equal(registry.Get("npm"), system1);
    });

    test("RegisterResolved throws when an action consumes an artifact not produced earlier", () =>
    {
        const key = new ArtifactKey<number>("Model");
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const emit = new FakeAction("emit", [key], []);
        const compile = new FakeAction("compile", [], [key]);
        // emit consumes before compile produces — invalid order.
        assert.throws(() => registry.RegisterResolved(new FakeSystem("bad", [emit, compile])), /emit/);
    });

    test("RegisterResolved systems are returned by Get and For", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const lib = new FakeSystem("lib", [], "library");
        const meta = new FakeSystem("meta", [], "meta-model");
        registry.RegisterResolved(lib);
        registry.RegisterResolved(meta);
        assert.equal(registry.Get("lib"), lib);
        const applicable = registry.For(targetOf("library"));
        assert.deepEqual(applicable.map((s) => s.Id), ["lib"]);
    });
});
