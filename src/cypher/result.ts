import type { CypherWriteStats, CypherWriteStatsDto } from "./writer.js";
import type { CypherValue, CypherValueDto } from "./values.js";

export class CypherResult
{
    constructor(public readonly Columns: readonly string[], public readonly Rows: readonly (readonly CypherValue[])[], public readonly Truncated: boolean = false, public readonly HasMore: boolean = false, public readonly Stats?: CypherWriteStats)
    {
    }
}

export interface CypherResultDto
{
    Columns: string[];
    Rows: CypherValueDto[][];
    Truncated: boolean;
    HasMore: boolean;
    Stats?: CypherWriteStatsDto;
}
