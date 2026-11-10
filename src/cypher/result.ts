import type { CypherWriteStats } from "./writer.js";
import type { CypherValue } from "./values.js";

export class CypherResult
{
    constructor(public readonly Columns: readonly string[], public readonly Rows: readonly (readonly CypherValue[])[], public readonly Truncated: boolean = false, public readonly HasMore: boolean = false, public readonly Stats?: CypherWriteStats)
    {
    }
}

export type { CypherResultDto } from "../graph-api/wire/index.js";
