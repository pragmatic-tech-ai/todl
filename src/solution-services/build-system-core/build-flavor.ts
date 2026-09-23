import type { CoreBuildContext, IBuildAction } from "./build-action.js";

// A selectable build-output variant a build system provides for a project type
// (spec §3). It owns what used to live on the system: the output directory name
// and the ordered action pipeline. A system exposes one or more flavors; the
// caller selects one by Id (defaulting to the first).
export interface BuildFlavor<C extends CoreBuildContext>
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly OutputName: string;
    Actions(): readonly IBuildAction<C>[];
}

// A flavor whose action list is fixed at construction — the common case (a system
// hands the manager a pre-built pipeline). A system with a single output wraps its
// one pipeline in a single StaticBuildFlavor.
export class StaticBuildFlavor<C extends CoreBuildContext> implements BuildFlavor<C>
{
    constructor(
        public readonly Id: string,
        public readonly DisplayName: string,
        public readonly OutputName: string,
        private readonly actions: readonly IBuildAction<C>[],
    )
    {
    }

    public Actions(): readonly IBuildAction<C>[]
    {
        return this.actions;
    }
}
