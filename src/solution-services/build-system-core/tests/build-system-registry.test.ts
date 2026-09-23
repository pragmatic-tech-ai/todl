import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../artifact-key.js";
import { BuildSystemRegistry } from "../build-system-registry.js";
import type { CoreBuildContext, IBuildAction } from "../build-action.js";
import type { IBuildSystem } from "../build-system.js";
import { StaticBuildFlavor, type BuildFlavor } from "../build-flavor.js";

// A minimal build target for the core registry test — the registry is generic over the
// target type, so this test binds it to a local shape and stays free of any todl type.
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

    public get OutputName(): string
    {
        return this.Id;
    }

    public AppliesTo(target: FakeTarget): boolean
    {
        return this.appliesTo === undefined || target.type === this.appliesTo;
    }

    public Actions(): readonly IBuildAction<CoreBuildContext>[]
    {
        return this.actions;
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

describe("BuildSystemRegistry", () =>
{
    test("Get returns a registered system, undefined for an unknown id", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const system = new FakeSystem("npm", []);
        registry.Register(system);
        assert.equal(registry.Get("npm"), system);
        assert.equal(registry.Get("missing"), undefined);
    });

    test("For returns only systems whose AppliesTo holds for the target", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const lib = new FakeSystem("lib", [], "library");
        const meta = new FakeSystem("meta", [], "meta-model");
        registry.Register(lib);
        registry.Register(meta);
        const applicable = registry.For(targetOf("library"));
        assert.deepEqual(applicable.map((s) => s.Id), ["lib"]);
    });

    test("Register accepts a valid consume-after-produce chain", () =>
    {
        const key = new ArtifactKey<number>("Model");
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const compile = new FakeAction("compile", [], [key]);
        const emit = new FakeAction("emit", [key], []);
        registry.Register(new FakeSystem("ok", [compile, emit]));
        assert.equal(registry.Get("ok")?.Id, "ok");
    });

    test("Register throws when an action consumes an artifact not produced earlier", () =>
    {
        const key = new ArtifactKey<number>("Model");
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        const emit = new FakeAction("emit", [key], []);
        const compile = new FakeAction("compile", [], [key]);
        // emit consumes before compile produces — invalid order.
        assert.throws(() => registry.Register(new FakeSystem("bad", [emit, compile])), /emit/);
    });

    test("Register rejects a duplicate id", () =>
    {
        const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
        registry.Register(new FakeSystem("npm", []));
        assert.throws(() => registry.Register(new FakeSystem("npm", [])), /npm/);
    });
});

describe("BuildSystemRegistry.SelectFlavor", () =>
{
    test("returns the first flavor when no id is given", () =>
    {
        const system = new FakeSystem("npm", []);
        assert.equal(BuildSystemRegistry.SelectFlavor(system)?.Id, "npm");
    });

    test("returns the flavor matching the given id", () =>
    {
        const system = new FakeSystem("npm", []);
        assert.equal(BuildSystemRegistry.SelectFlavor(system, "npm")?.Id, "npm");
    });

    test("returns undefined for an unknown flavor id", () =>
    {
        const system = new FakeSystem("npm", []);
        assert.equal(BuildSystemRegistry.SelectFlavor(system, "nope"), undefined);
    });
});
