import type { Scalar } from "../manifest/logical.js";
import { RelDirection } from "./enums.js";

export class NodePattern
{
    constructor(
        public readonly Variable: string | undefined,
        public readonly Label: string | undefined,
        public readonly Properties: ReadonlyMap<string, Scalar>,
    )
    {
    }
}

export class RelPattern
{
    constructor(
        public readonly Variable: string | undefined,
        public readonly RelType: string | undefined,
        public readonly Direction: RelDirection,
        public readonly Properties: ReadonlyMap<string, Scalar>,
        // Both undefined = fixed single hop. Variable-length: MinHops defaults to 1 when only the star is given;
        // MaxHops undefined with MinHops defined = unbounded (planner applies MaxVarLength).
        public readonly MinHops: number | undefined = undefined,
        public readonly MaxHops: number | undefined = undefined,
    )
    {
    }

    public get IsVariableLength(): boolean
    {
        return this.MinHops !== undefined || this.MaxHops !== undefined;
    }
}

export class PatternPath
{
    // Invariant: Nodes.length === Rels.length + 1.
    constructor(
        public readonly Nodes: readonly NodePattern[],
        public readonly Rels: readonly RelPattern[],
        public readonly PathVariable: string | undefined = undefined,
    )
    {
    }
}
