import { PackageSecurity, type IEdgeConcept, type IPackageSecurity } from '../../compiler-services/security/package-security.js';
import type { PackageDocument } from '../../publish/publish.js';
import type { IExternalBinding } from '../external/ExternalBinding.js';
import { MessageFormat } from '../MessageFormat.js';
import { SystemNames } from '../system/SystemNames.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';

/** One environment's security surface: every chosen package's compiled security, read from its document. */
export interface IEnvironmentSecurity
{
    /** Package model id → its security (`todl.system`, and a document without `security`, → PackageSecurity.Empty). */
    readonly Packages: ReadonlyMap<string, IPackageSecurity>;
    /** The union of every package's EdgeConcepts, sorted by Concept. */
    readonly EdgeConcepts: readonly IEdgeConcept[];
}

/**
 * The environment's security, composed from the same documents as the catalog that carries it (spec §9.4: a host that
 * swaps the catalog swaps the security in the same step). Compose rejects a package whose security names a concept
 * another package is home to (ForeignSecurityConcept: a hand-made or stale document) and an owned or field-secured
 * concept that any package binds to an external connector (SecuredExternalConcept, spec §6).
 */
export class EnvironmentSecurity implements IEnvironmentSecurity
{
    private static readonly ForeignMessage = 'the security of package "{0}"{1} names "{2}", which {3} declares; a package may secure only its own concepts';
    private static readonly UnknownHome = 'no package';
    private static readonly HomePackage = 'package "{0}"';
    private static readonly ExternalMessage = 'package "{0}"{1} binds "{2}" to connector "{3}", but package "{4}" owns it or secures a field of it; connector data cannot carry ownership or secured fields';

    public readonly Packages: ReadonlyMap<string, IPackageSecurity>;
    public readonly EdgeConcepts: readonly IEdgeConcept[];

    private constructor(packages: ReadonlyMap<string, IPackageSecurity>)
    {
        this.Packages = packages;
        this.EdgeConcepts = Object.freeze(EnvironmentSecurity.UnionEdgeConcepts(packages));
    }

    /**
     * The security of every package in `documents` (model id → its chosen document), validated against `homeModels`
     * (concept → home model id) and the described `external` bindings; `deliveries` (model → delivery names) names
     * the deliveries in an error.
     */
    public static Compose(documents: ReadonlyMap<string, PackageDocument>, homeModels: ReadonlyMap<string, string>,
        external: readonly IExternalBinding[], deliveries: ReadonlyMap<string, readonly string[]>): EnvironmentSecurity
    {
        const packages = new Map<string, IPackageSecurity>();
        for (const [model, doc] of documents)
        {
            const security = model === SystemNames.Model ? PackageSecurity.Empty : (doc.security ?? PackageSecurity.Empty);
            EnvironmentSecurity.RejectForeign(model, security, homeModels, deliveries);
            packages.set(model, security);
        }
        EnvironmentSecurity.RejectExternal(packages, external, deliveries);
        return new EnvironmentSecurity(packages);
    }

    /** The union of every package's OwnedConcepts. */
    public OwnedConcepts(): ReadonlySet<string>
    {
        return new Set([...this.Packages.values()].flatMap((s) => s.OwnedConcepts));
    }

    /** Every concept a package's security names: owned, privileged, secured, profiled or reified as an edge. */
    private static Named(security: IPackageSecurity): Set<string>
    {
        return new Set([
            ...security.OwnedConcepts,
            ...[...security.Roles, ...security.BaseRoleContributions].flatMap((r) => r.Privileges.map((p) => p.Concept)),
            ...security.SecuredFields.map((f) => f.Concept),
            ...security.FieldProfiles.flatMap((p) => p.Fields.map((f) => f.Concept)),
            ...security.EdgeConcepts.map((e) => e.Concept),
        ]);
    }

    private static RejectForeign(model: string, security: IPackageSecurity, homeModels: ReadonlyMap<string, string>,
        deliveriesOf: ReadonlyMap<string, readonly string[]>): void
    {
        for (const concept of [...EnvironmentSecurity.Named(security)].sort())
        {
            const home = homeModels.get(concept);
            if (home === model) continue;
            const deliveries = [...(deliveriesOf.get(model) ?? [])].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ForeignSecurityConcept, concept, deliveries,
                MessageFormat.Format(EnvironmentSecurity.ForeignMessage, model, EnvironmentCatalogError.DeliveredBy(deliveries), concept,
                    home === undefined ? EnvironmentSecurity.UnknownHome : MessageFormat.Format(EnvironmentSecurity.HomePackage, home)));
        }
    }

    private static RejectExternal(packages: ReadonlyMap<string, IPackageSecurity>, external: readonly IExternalBinding[],
        deliveriesOf: ReadonlyMap<string, readonly string[]>): void
    {
        const securedBy = new Map<string, string>();
        for (const [model, security] of packages)
        {
            for (const concept of [...security.OwnedConcepts, ...security.SecuredFields.map((f) => f.Concept)])
            {
                if (!securedBy.has(concept)) securedBy.set(concept, model);
            }
        }
        for (const binding of external)
        {
            const securer = securedBy.get(binding.Binding.Concept);
            if (securer === undefined) continue;
            const deliveries = [...new Set([binding.Model, securer].flatMap((m) => deliveriesOf.get(m) ?? []))].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.SecuredExternalConcept, binding.Binding.Concept, deliveries,
                MessageFormat.Format(EnvironmentSecurity.ExternalMessage, binding.Model, EnvironmentCatalogError.DeliveredBy(deliveries),
                    binding.Binding.Concept, binding.Connector, securer));
        }
    }

    /** Every package's edge concepts, sorted by Concept (each concept once: RejectForeign keeps it to its home package). */
    private static UnionEdgeConcepts(packages: ReadonlyMap<string, IPackageSecurity>): IEdgeConcept[]
    {
        return [...packages.values()].flatMap((s) => s.EdgeConcepts).sort((a, b) => (a.Concept < b.Concept ? -1 : a.Concept > b.Concept ? 1 : 0));
    }
}
