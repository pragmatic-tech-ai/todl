import type { PackageRef, PackageSource, ResolvedPackage } from '../../domain/domain.js';

/**
 * A package source that loads the unified versions (ruling T11): a ref to a model with a chosen version, and every
 * dependency a resolved package declares, is redirected to the chosen version, so a Domain loads one version of each
 * model however many packages ask for it. Models without a chosen version pass through unchanged.
 */
export class UnifiedPackageSource implements PackageSource
{
    public constructor(private readonly inner: PackageSource, private readonly chosen: ReadonlyMap<string, string>) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        const resolved = await this.inner.resolve(this.Redirect(ref));
        return { ...resolved, dependencies: resolved.dependencies.map((d) => this.Redirect(d)) };
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        const version = this.chosen.get(model);
        if (version !== undefined) return [version];
        return (await this.inner.versions?.(model)) ?? [];
    }

    private Redirect(ref: PackageRef): PackageRef
    {
        const version = this.chosen.get(ref.model);
        return version === undefined ? ref : { model: ref.model, version };
    }
}
