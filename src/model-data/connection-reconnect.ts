import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";

export enum ConnectionFailureKind
{
    Transient = "transient",
    Auth = "auth",
    Permanent = "permanent",
}

export interface ConnectionRetryPolicy
{
    InitialDelayMs: number;
    Factor: number;
    MaxDelayMs: number;
    MaxAttempts: number;
}

/** Exponential backoff with full jitter, capped at MaxDelayMs. */
export class ConnectionRetryBackoff
{
    private readonly policy: ConnectionRetryPolicy;
    private readonly random: () => number;

    public constructor(policy: ConnectionRetryPolicy, random: () => number = Math.random)
    {
        this.policy = policy;
        this.random = random;
    }

    /** Backoff delay in ms for a retry; `attempt` is 1-based (the first retry is attempt 1). */
    public Next(attempt: number): number
    {
        const raw = this.policy.InitialDelayMs * Math.pow(this.policy.Factor, Math.max(0, attempt - 1));
        const capped = Math.min(this.policy.MaxDelayMs, raw);
        return Math.floor(this.random() * capped);
    }
}

export interface ReconnectEvent
{
    Connector: string;
    Kind: ConnectionFailureKind;
    Attempt: number;
    Message: string;
}

export interface IReconnectObserver
{
    OnReconnect(event: ReconnectEvent): void;
}

export const ReconnectObserverKey = new ServiceKey<IReconnectObserver>("ConnectorReconnectObserver");
