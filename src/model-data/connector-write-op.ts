// The write contract beneath a ModelDataSource: a batch of create / update /
// delete operations handed to a connector that supports writes, and the
// per-operation outcomes it reports back.

export enum ConnectorWriteOpKind
{
    Create,
    Update,
    Delete,
}

export enum ConnectorWriteStatus
{
    Applied,
    Conflict,
    Denied,
    Invalid,
    Failed,
}

export interface ConnectorWriteOp
{
    readonly Kind: ConnectorWriteOpKind;
    readonly Concept: string;
    readonly Id?: string;
    readonly Fields?: Record<string, unknown>;
}

export interface ConnectorWriteOpResult
{
    readonly Status: ConnectorWriteStatus;
    readonly Id?: string;
    readonly Reason?: string;
}

export interface ConnectorWriteResult
{
    readonly Results: readonly ConnectorWriteOpResult[];
}
