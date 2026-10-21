// Emits the servable-app manifest a tenant serves for a deployed remote app.
// Shape mirrors the protocol's ServableAppManifestDto; declared structurally here
// so the engine takes no dependency on the protocol package.

export interface ServablePackageRef
{
    id: string;
    version: string;
}

export interface ServableAppManifest
{
    name: string;
    version: string;
    packages: ServablePackageRef[];
    ui: { entry: string; assets: string[] };
}

export class ServableManifest
{
    public static For(
        name: string,
        version: string,
        packages: readonly ServablePackageRef[],
        entry: string,
        assets: readonly string[],
    ): ServableAppManifest
    {
        return {
            name,
            version,
            packages: packages.map(p => ({ id: p.id, version: p.version })),
            ui: { entry, assets: [...assets] },
        };
    }
}
