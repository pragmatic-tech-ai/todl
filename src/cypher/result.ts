import type { CypherValue, CypherValueDto } from "./values.js";

export class CypherResult
{
    constructor(public readonly Columns: readonly string[], public readonly Rows: readonly (readonly CypherValue[])[], public readonly Truncated: boolean = false, public readonly HasMore: boolean = false)
    {
    }
}

export interface CypherResultDto
{
    Columns: string[];
    Rows: CypherValueDto[][];
    Truncated: boolean;
    HasMore: boolean;
}
