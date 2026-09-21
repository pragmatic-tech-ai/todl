import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../artifact-key.js";
import { BuildSystemRegistry } from "../build-system-registry.js";
import type { IBuildAction, BuildActionContext } from "../build-action.js";
import type { IBuildSystem } from "../build-system.js";
import { ProjectType, type ProjectManifest } from "../../package-manager/manifest.js";

class FakeAction implements IBuildAction
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

    public Execute(_ctx: BuildActionContext): Promise<void>
    {
        return Promise.resolve();
    }
}

class FakeSystem implements IBuildSystem
{
    constructor(
        public readonly Id: string,
        private readonly actions: readonly IBuildAction[],
        private readonly appliesTo: ProjectType | undefined = undefined,
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

    public AppliesTo(manifest: ProjectManifest): boolean
    {
        return this.appliesTo === undefined || manifest.type === this.appliesTo;
    }

    public Actions(): readonly IBuildAction[]
    {
        return this.actions;
    }
}

function manifestOf(type: ProjectType): ProjectManifest
{
    return { type, name: "demo", version: 1 };
}

describe("BuildSystemRegistry", () =>
{
    test("Get returns a registered system, undefined for an unknown id", () =>
    {
        const registry = new BuildSystemRegistry();
        const system = new FakeSystem("npm", []);
        registry.Register(system);
        assert.equal(registry.Get("npm"), system);
        assert.equal(registry.Get("missing"), undefined);
    });

    test("For returns only systems whose AppliesTo holds for the manifest", () =>
    {
        const registry = new BuildSystemRegistry();
        const lib = new FakeSystem("lib", [], ProjectType.Library);
        const meta = new FakeSystem("meta", [], ProjectType.MetaModel);
        registry.Register(lib);
        registry.Register(meta);
        const applicable = registry.For(manifestOf(ProjectType.Library));
        assert.deepEqual(applicable.map((s) => s.Id), ["lib"]);
    });

    test("Register accepts a valid consume-after-produce chain", () =>
    {
        const key = new ArtifactKey<number>("Model");
        const registry = new BuildSystemRegistry();
        const compile = new FakeAction("compile", [], [key]);
        const emit = new FakeAction("emit", [key], []);
        registry.Register(new FakeSystem("ok", [compile, emit]));
        assert.equal(registry.Get("ok")?.Id, "ok");
    });

    test("Register throws when an action consumes an artifact not produced earlier", () =>
    {
        const key = new ArtifactKey<number>("Model");
        const registry = new BuildSystemRegistry();
        const emit = new FakeAction("emit", [key], []);
        const compile = new FakeAction("compile", [], [key]);
        // emit consumes before compile produces — invalid order.
        assert.throws(() => registry.Register(new FakeSystem("bad", [emit, compile])), /emit/);
    });

    test("Register rejects a duplicate id", () =>
    {
        const registry = new BuildSystemRegistry();
        registry.Register(new FakeSystem("npm", []));
        assert.throws(() => registry.Register(new FakeSystem("npm", [])), /npm/);
    });
});
