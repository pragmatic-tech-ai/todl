import type { IDataSourceAdapterFactory } from "./data-source-adapter.js";

/** The ABI an adapter pack's entry module default-exports: the host obtains the pack's adapter
 *  factories through it. Depends only on engine types so a pack never couples to the host. */
export interface IAdapterPack
{
    Factories(): readonly IDataSourceAdapterFactory[];
}
