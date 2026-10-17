import type { IDataSourceAdapter } from "./data-source-adapter.js";

/** The optional write-capability members of an adapter, read without requiring the full adapter. */
export type IWriteCapable = Pick<IDataSourceAdapter, "CanTransact" | "CanVersion">;

/** Reads an adapter's optional write capabilities, defaulting an absent capability to the weakest guarantee. */
export class WriteCapability
{
    /** Whether the adapter can run a batch inside a backend transaction (absent ⇒ false). */
    public static CanTransact(adapter: IWriteCapable): boolean
    {
        return adapter.CanTransact === true;
    }

    /** Whether the adapter can enforce an optimistic version guard (absent ⇒ false). */
    public static CanVersion(adapter: IWriteCapable): boolean
    {
        return adapter.CanVersion === true;
    }
}
