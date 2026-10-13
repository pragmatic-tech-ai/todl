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

export class CypherSemanticError extends CypherError
{
    constructor(message: string)
    {
        super(message);
    }
}
