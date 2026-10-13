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
    )
    {
    }
}

export class PatternPath
{
    // Invariant: Nodes.length === Rels.length + 1.
    constructor(public readonly Nodes: readonly NodePattern[], public readonly Rels: readonly RelPattern[])
    {
    }
}
