import type { IAdapterWriteCapabilities, IDataSourceAdapter } from "./data-source-adapter.js";

/** The optional write-capability members of an opened adapter OR a factory's pre-open descriptor. */
export type IWriteCapable = Pick<IDataSourceAdapter, "CanTransact" | "CanVersion" | "CanAssignKeys" | "SourceManagesVersions"> | IAdapterWriteCapabilities;

/** Reads optional write capabilities, defaulting an absent capability to the weakest guarantee. */
export class WriteCapability
{
    /** Whether a batch can run inside a backend transaction (absent -> false). */
    public static CanTransact(adapter: IWriteCapable): boolean
    {
        return adapter.CanTransact === true;
    }

    /** Whether an optimistic version guard can be enforced (absent -> false). */
    public static CanVersion(adapter: IWriteCapable): boolean
    {
        return adapter.CanVersion === true;
    }

    /** Whether source-keyed inserts can report assigned keys (absent -> false). */
    public static CanAssignKeys(adapter: IWriteCapable): boolean
    {
        return adapter.CanAssignKeys === true;
    }

    /** Whether the source assigns versions itself (absent -> false). */
    public static SourceManagesVersions(adapter: IWriteCapable): boolean
    {
        return adapter.SourceManagesVersions === true;
    }
}
