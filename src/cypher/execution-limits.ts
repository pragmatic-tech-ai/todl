import { CypherTimeout } from "./errors.js";

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

// Per-execution cancellation probe used by buffering operators: Begin() checks once up front (so an
// already-expired token aborts even over a tiny child); Tick() checks every CheckInterval rows.
export class CancelProbe
{
    private static readonly CheckInterval = 1000;
    private count = 0;

    constructor(private readonly cancel: ICancellation | undefined)
    {
    }

    public Begin(): void
    {
        this.Check();
    }

    public Tick(): void
    {
        if (this.cancel !== undefined && ++this.count % CancelProbe.CheckInterval === 0)
        {
            this.Check();
        }
    }

    private Check(): void
    {
        if (this.cancel?.Expired() === true)
        {
            throw new CypherTimeout();
        }
    }
}
