import type { IDataSourceAdapterFactory } from "./data-source-adapter.js";

/** The ABI an adapter pack's entry module default-exports: the host obtains the pack's adapter
 *  factories through it. Depends only on engine types so a pack never couples to the host. */
export interface IAdapterPack
{
    Factories(): readonly IDataSourceAdapterFactory[];
}

/** Default {@link IAdapterPack} implementation a pack's entry module default-exports. */
export class AdapterPack implements IAdapterPack
{
    public constructor(private readonly factories: readonly IDataSourceAdapterFactory[])
    {
    }

    public static Of(...factories: readonly IDataSourceAdapterFactory[]): AdapterPack
    {
        return new AdapterPack(factories);
    }

    public Factories(): readonly IDataSourceAdapterFactory[]
    {
        return this.factories;
    }
}

/** The shape of the `todl.adapterPack` block a pack declares in its package.json. */
export interface AdapterPackManifest
{
    readonly entry: string;
    readonly kinds: readonly string[];
    readonly sdk: string;
}

/** The package.json contract an adapter pack follows: the host reads `todl.adapterPack`, the author
 *  writes it with the current ABI version. */
export class AdapterPackContract
{
    public static readonly TodlBlockKey = "todl";
    public static readonly ManifestKey = "adapterPack";
    /** Current adapter-pack ABI version; packs set `todl.adapterPack.sdk` to this. */
    public static readonly AbiVersion = "1";
}
