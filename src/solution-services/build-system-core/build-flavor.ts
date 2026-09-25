import type { CoreBuildContext, IBuildAction } from "./build-action.js";

// A file that must already exist in the project before this flavor can build — produced
// by a generator, not by the build (the "require, never create" boundary). GeneratorId is
// an opaque string used only in the failure message; build-system-core stays todl-agnostic.
export interface RequiredContent
{
    readonly Path: string;
    readonly GeneratorId?: string;
    readonly Description?: string;
}

// A selectable build-output variant a build system provides for a project type
// (spec §3). It owns what used to live on the system: the output directory name
// and the ordered action pipeline. A system exposes one or more flavors; the
// caller selects one by Id (defaulting to the first). Requires lists the project
// content this flavor needs to already exist (spec: require, never create).
export interface BuildFlavor<C extends CoreBuildContext>
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly OutputName: string;
    readonly Requires: readonly RequiredContent[];
    Actions(): readonly IBuildAction<C>[];
}

// A flavor whose action list is fixed at construction — the common case (a system
// hands the manager a pre-built pipeline). A system with a single output wraps its
// one pipeline in a single StaticBuildFlavor. Requires defaults to [] so every
// existing 4-arg construction stays valid.
export class StaticBuildFlavor<C extends CoreBuildContext> implements BuildFlavor<C>
{
    constructor(
        public readonly Id: string,
        public readonly DisplayName: string,
        public readonly OutputName: string,
        private readonly actions: readonly IBuildAction<C>[],
        public readonly Requires: readonly RequiredContent[] = [],
    )
    {
    }

    public Actions(): readonly IBuildAction<C>[]
    {
        return this.actions;
    }
}
