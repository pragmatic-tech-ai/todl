import type { CypherValue, CypherValueDto } from "./values.js";

export class CypherResult
{
    constructor(public readonly Columns: readonly string[], public readonly Rows: readonly (readonly CypherValue[])[])
    {
    }
}

export interface CypherResultDto
{
    Columns: string[];
    Rows: CypherValueDto[][];
}
