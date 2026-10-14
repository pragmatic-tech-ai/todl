export interface ICancellation
{
    Expired(): boolean;
}

export class Deadline implements ICancellation
{
    private constructor(private readonly at: number)
    {
    }

    public static After(ms: number): Deadline
    {
        return new Deadline(Date.now() + ms);
    }

    public Expired(): boolean
    {
        return Date.now() >= this.at;
    }
}

export interface ExecutionLimits
{
    readonly RowCap?: number;
    readonly Cancel?: ICancellation;
}
