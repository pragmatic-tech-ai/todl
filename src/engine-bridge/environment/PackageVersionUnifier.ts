import type { PackageRef, PackageSource } from '../../domain/domain.js';
import { MessageFormat } from '../MessageFormat.js';
import type { IPackageDelivery } from './PackageDelivery.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';

/** A version string read for unification (ruling T11): semver when it is exactly `major.minor.patch`. */
class UnifiedVersion
{
    private static readonly SemverPattern = /^(\d+)\.(\d+)\.(\d+)$/;

    private readonly parts: readonly number[] | undefined;

    public constructor(public readonly Text: string)
    {
        const match = UnifiedVersion.SemverPattern.exec(Text);
        this.parts = match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    /** Equal, or both semver with one major of at least 1, or both major 0 with one minor. */
    public CompatibleWith(other: UnifiedVersion): boolean
    {
        if (this.Text === other.Text) return true;
        const a = this.parts;
        const b = other.parts;
        if (a === undefined || b === undefined || a[0] !== b[0]) return false;
        return a[0]! >= 1 || a[1] === b[1];
    }

    /** Orders compatible versions (so both semver, or equal): by major, minor, then patch. */
    public Compare(other: UnifiedVersion): number
    {
        const a = this.parts ?? [];
        const b = other.parts ?? [];
        for (let i = 0; i < a.length && i < b.length; i++)
        {
            if (a[i] !== b[i]) return a[i]! - b[i]!;
        }
        return 0;
    }
}

/** The unified package set: each model's chosen version and the deliveries whose closure asked for that model. */
export interface IUnifiedPackages
{
    /** model → chosen version, in model order. */
    readonly Chosen: ReadonlyMap<string, string>;
    /** model → the names of the deliveries that asked for it (directly or through dependencies), sorted. */
    readonly Deliveries: ReadonlyMap<string, readonly string[]>;
}

/**
 * Ruling T11: unifies the package versions a set of deliveries asks for into one version per model. The requested set
 * is every root ref of every delivery plus the declared dependencies of every requested version, transitively (so a
 * superseded version's dependencies are still checked). All requested versions of a model must be pairwise compatible
 * (UnifiedVersion), else IncompatibleVersions naming the model, the versions and the deliveries; the highest wins.
 */
export class PackageVersionUnifier
{
    private static readonly IncompatibleMessage = 'model "{0}" is requested at incompatible versions: {1}';
    private static readonly RequestFormat = '{0} (by {1})';
    private static readonly ListSeparator = ', ';
    private static readonly IdentitySeparator = '@';
    private static readonly KeySeparator = '\u0000';

    /** model → version → the deliveries that asked for it. */
    private readonly requests = new Map<string, Map<string, Set<string>>>();
    /** `model@version` → its declared dependencies (resolved once). */
    private readonly dependencies = new Map<string, readonly PackageRef[]>();
    /** `model@version` + delivery pairs already walked. */
    private readonly walked = new Set<string>();

    private constructor(private readonly source: PackageSource) {}

    public static async Unify(roots: readonly IPackageDelivery[], source: PackageSource): Promise<ReadonlyMap<string, string>>
    {
        return (await PackageVersionUnifier.Resolve(roots, source)).Chosen;
    }

    /** Unify, also returning which deliveries asked for each model (for the composer's error attribution). */
    public static async Resolve(roots: readonly IPackageDelivery[], source: PackageSource): Promise<IUnifiedPackages>
    {
        const unifier = new PackageVersionUnifier(source);
        for (const delivery of roots)
        {
            for (const ref of delivery.Packages)
            {
                await unifier.Request(ref, delivery.Name);
            }
        }
        return unifier.Choose();
    }

    private async Request(ref: PackageRef, delivery: string): Promise<void>
    {
        const version = ref.version ?? (await this.source.resolve(ref)).ref.version;
        const identity = ref.model + PackageVersionUnifier.IdentitySeparator + version;
        const key = identity + PackageVersionUnifier.KeySeparator + delivery;
        if (this.walked.has(key)) return;
        this.walked.add(key);
        let versions = this.requests.get(ref.model);
        if (versions === undefined)
        {
            versions = new Map();
            this.requests.set(ref.model, versions);
        }
        let by = versions.get(version);
        if (by === undefined)
        {
            by = new Set();
            versions.set(version, by);
        }
        by.add(delivery);
        let deps = this.dependencies.get(identity);
        if (deps === undefined)
        {
            deps = (await this.source.resolve({ model: ref.model, version })).dependencies;
            this.dependencies.set(identity, deps);
        }
        for (const dep of deps)
        {
            await this.Request(dep, delivery);
        }
    }

    private Choose(): IUnifiedPackages
    {
        const chosen = new Map<string, string>();
        const deliveries = new Map<string, readonly string[]>();
        for (const model of [...this.requests.keys()].sort())
        {
            const versions = this.requests.get(model)!;
            const parsed = [...versions.keys()].map((v) => new UnifiedVersion(v));
            const names = [...new Set([...versions.values()].flatMap((s) => [...s]))].sort();
            if (!parsed.every((v) => v.CompatibleWith(parsed[0]!)))
            {
                const list = parsed
                    .map((v) => MessageFormat.Format(PackageVersionUnifier.RequestFormat, v.Text, [...versions.get(v.Text)!].sort().join(PackageVersionUnifier.ListSeparator)))
                    .join(PackageVersionUnifier.ListSeparator);
                throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.IncompatibleVersions, model, names,
                    MessageFormat.Format(PackageVersionUnifier.IncompatibleMessage, model, list));
            }
            const highest = parsed.reduce((best, v) => (v.Compare(best) > 0 ? v : best));
            chosen.set(model, highest.Text);
            deliveries.set(model, names);
        }
        return { Chosen: chosen, Deliveries: deliveries };
    }
}
