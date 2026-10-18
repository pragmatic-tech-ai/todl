export class CypherError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = new.target.name;
    }
}

export class CypherSyntaxError extends CypherError
{
    constructor(message: string, public readonly Line: number, public readonly Column: number)
    {
        super(`${message} (line ${Line}, column ${Column})`);
    }
}

export class CypherTimeout extends CypherError
{
    private static readonly Message = "query exceeded its execution deadline";

    constructor()
    {
        super(CypherTimeout.Message);
    }
}

export class CypherSemanticError extends CypherError
{
    constructor(message: string)
    {
        super(message);
    }
}

// Write-time semantic failure (distinct from CypherSemanticError so callers can classify it).
export class CypherWriteError extends CypherError
{
    constructor(message: string)
    {
        super(message);
    }
}
