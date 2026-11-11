import type { IDefinitionDescription, ISchemaDescription } from '@pragmatic-tech-ai/graph';
import { MetaKind } from '../../compiler-services/model/kinds.js';
import { PackageSecurity, type IEdgeConcept, type IPackageSecurity } from '../../compiler-services/security/package-security.js';
import type { PackageDocument } from '../../publish/publish.js';
import type { IExternalBinding } from '../external/ExternalBinding.js';
import { MessageFormat } from '../MessageFormat.js';
import { SystemNames } from '../system/SystemNames.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';

/** One environment's security surface: every chosen package's compiled security, read from its document. */
export interface IEnvironmentSecurity
{
    /** Package model id → its security as compiled (`todl.system`, and a document without `security`, → PackageSecurity.Empty). */
    readonly Packages: ReadonlyMap<string, IPackageSecurity>;
    /** The union of every package's EdgeConcepts, sorted by Concept. */
    readonly EdgeConcepts: readonly IEdgeConcept[];
    /**
     * The environment's effective owned set: every concept of the composed description that IsA todl.system.Owned. It
     * is recomputed by every Compose, so a dependent package unified onto a newer dependency is judged by the dependency
     * it now runs against, not the one it compiled against (each package's own OwnedConcepts stay as compiled).
     */
    OwnedConcepts(): ReadonlySet<string>;
}

/**
 * The environment's security, composed from the same documents as the catalog that carries it (spec §9.4: a host that
 * swaps the catalog swaps the security in the same step). Compose rejects a package whose security names a concept
 * another package is home to and it does not declare itself (ForeignSecurityConcept: a hand-made or stale document), an
 * owned or field-secured concept that any package binds to an external connector (SecuredExternalConcept, spec §6), and
 * one edge concept reified with two different endpoint pairs (ConflictingEdgeConcept). Ownership and secured fields are
 * judged over the composed description: a concept inherits both from its ancestors as unified, not as compiled.
 */
export class EnvironmentSecurity implements IEnvironmentSecurity
{
    /** Fired only when the named concept is neither homed to the package nor declared in its own document (ruling T12). */
    private static readonly ForeignMessage = 'the security of package "{0}"{1} names "{2}", which package "{3}" declares and package "{0}" does not; a package may secure only concepts it declares';
    /** The ForeignSecurityConcept message when no package in the environment declares the named concept. */
    private static readonly UndeclaredMessage = 'the security of package "{0}"{1} names "{2}", which no package in the environment declares; a package may secure only concepts it declares';
    private static readonly ExternalMessage = 'package "{0}"{1} binds "{2}" to connector "{3}", but package "{4}" owns it or secures a field of it; connector data cannot carry ownership or secured fields';
    private static readonly ConflictingEdgeMessage = 'edge concept "{0}"{1} is reified with different endpoints by packages {2}; one edge concept has one endpoint pair';
    private static readonly QuotedModel = '"{0}"';
    private static readonly ListSeparator = ', ';

    public readonly Packages: ReadonlyMap<string, IPackageSecurity>;
    public readonly EdgeConcepts: readonly IEdgeConcept[];
    private readonly owned: ReadonlySet<string>;

    private constructor(packages: ReadonlyMap<string, IPackageSecurity>, edgeConcepts: readonly IEdgeConcept[], owned: ReadonlySet<string>)
    {
        this.Packages = packages;
        this.EdgeConcepts = Object.freeze([...edgeConcepts]);
        this.owned = owned;
    }

    /**
     * The security of every package in `documents` (model id → its chosen document), validated against `homeModels`
     * (concept → home model id), the composed `description` (the inheritance the environment runs) and the described
     * `external` bindings; `deliveries` (model → delivery names) names the deliveries in an error.
     */
    public static Compose(documents: ReadonlyMap<string, PackageDocument>, homeModels: ReadonlyMap<string, string>, description: ISchemaDescription,
        external: readonly IExternalBinding[], deliveries: ReadonlyMap<string, readonly string[]>): EnvironmentSecurity
    {
        const packages = new Map<string, IPackageSecurity>();
        for (const [model, doc] of documents)
        {
            const security = model === SystemNames.Model ? PackageSecurity.Empty : (doc.security ?? PackageSecurity.Empty);
            EnvironmentSecurity.RejectForeign(model, doc, security, homeModels, deliveries);
            packages.set(model, security);
        }
        const ancestry = EnvironmentSecurity.Ancestry(description);
        const owned = new Set([...ancestry].filter(([, ancestors]) => ancestors.has(SystemNames.Owned)).map(([concept]) => concept));
        EnvironmentSecurity.RejectExternal(packages, ancestry, owned, external, deliveries);
        return new EnvironmentSecurity(packages, EnvironmentSecurity.UnionEdgeConcepts(packages, deliveries), owned);
    }

    public OwnedConcepts(): ReadonlySet<string>
    {
        return this.owned;
    }

    /** Every described concept → itself and every ancestor it reaches through its parent and aspects, transitively. */
    private static Ancestry(description: ISchemaDescription): Map<string, Set<string>>
    {
        const byName = new Map<string, IDefinitionDescription>(description.Definitions.map((d) => [d.Name, d]));
        const ancestry = new Map<string, Set<string>>();
        for (const definition of description.Definitions)
        {
            if (definition.IsAspect) continue;
            const reached = new Set<string>();
            const pending = [definition.Name];
            while (pending.length > 0)
            {
                const name = pending.pop()!;
                if (reached.has(name)) continue;
                reached.add(name);
                const current = byName.get(name);
                if (current === undefined) continue;
                if (current.Parent !== null) pending.push(current.Parent);
                pending.push(...current.Aspects);
            }
            ancestry.set(definition.Name, reached);
        }
        return ancestry;
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

    /**
     * A package may secure a concept it is home to, or one its own document declares too: under ruling T12 two packages
     * that do not depend on each other may declare one concept identically, and only the lower model id is its home.
     */
    private static RejectForeign(model: string, doc: PackageDocument, security: IPackageSecurity, homeModels: ReadonlyMap<string, string>,
        deliveriesOf: ReadonlyMap<string, readonly string[]>): void
    {
        const declared = new Set(doc.nodes.filter((n) => n.metaKind === MetaKind.Concept).map((n) => n.id));
        for (const concept of [...EnvironmentSecurity.Named(security)].sort())
        {
            const home = homeModels.get(concept);
            if (home === model || declared.has(concept)) continue;
            const deliveries = [...(deliveriesOf.get(model) ?? [])].sort();
            const deliveredBy = EnvironmentCatalogError.DeliveredBy(deliveries);
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ForeignSecurityConcept, concept, deliveries, home === undefined
                ? MessageFormat.Format(EnvironmentSecurity.UndeclaredMessage, model, deliveredBy, concept)
                : MessageFormat.Format(EnvironmentSecurity.ForeignMessage, model, deliveredBy, concept, home));
        }
    }

    /**
     * Rejects an external binding of a concept that is owned in the composed description, or that has a secured field
     * declared on itself or on any ancestor (spec §6). The securer the error names is the lowest model id whose compiled
     * security owns or secures the concept or one of its ancestors (several T12 co-declarers may secure one concept);
     * todl.system when none does.
     */
    private static RejectExternal(packages: ReadonlyMap<string, IPackageSecurity>, ancestry: ReadonlyMap<string, ReadonlySet<string>>,
        owned: ReadonlySet<string>, external: readonly IExternalBinding[], deliveriesOf: ReadonlyMap<string, readonly string[]>): void
    {
        const fieldSecured = new Set<string>();
        const securedBy = new Map<string, string>();
        for (const model of [...packages.keys()].sort().reverse())
        {
            const security = packages.get(model)!;
            for (const field of security.SecuredFields) fieldSecured.add(field.Concept);
            for (const concept of [...security.OwnedConcepts, ...security.SecuredFields.map((f) => f.Concept)]) securedBy.set(concept, model);
        }
        for (const binding of external)
        {
            const concept = binding.Binding.Concept;
            const ancestors = [...(ancestry.get(concept) ?? [concept])];
            if (!owned.has(concept) && !ancestors.some((a) => fieldSecured.has(a))) continue;
            const securer = ancestors.map((a) => securedBy.get(a)).filter((m): m is string => m !== undefined).sort()[0] ?? SystemNames.Model;
            const deliveries = [...new Set([binding.Model, securer].flatMap((m) => deliveriesOf.get(m) ?? []))].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.SecuredExternalConcept, concept, deliveries,
                MessageFormat.Format(EnvironmentSecurity.ExternalMessage, binding.Model, EnvironmentCatalogError.DeliveredBy(deliveries),
                    concept, binding.Connector, securer));
        }
    }

    /**
     * Every package's edge concepts, sorted by Concept; identical T12 co-declarations of one edge concept appear once,
     * and two different endpoint pairs for one edge concept are ConflictingEdgeConcept.
     */
    private static UnionEdgeConcepts(packages: ReadonlyMap<string, IPackageSecurity>, deliveriesOf: ReadonlyMap<string, readonly string[]>): IEdgeConcept[]
    {
        const unique = new Map<string, IEdgeConcept>();
        const declarers = new Map<string, string[]>();
        for (const [model, security] of packages)
        {
            for (const edge of security.EdgeConcepts)
            {
                const models = declarers.get(edge.Concept) ?? [];
                models.push(model);
                declarers.set(edge.Concept, models);
                const previous = unique.get(edge.Concept);
                if (previous !== undefined && (previous.From !== edge.From || previous.To !== edge.To))
                {
                    const deliveries = [...new Set(models.flatMap((m) => deliveriesOf.get(m) ?? []))].sort();
                    const named = models.map((m) => MessageFormat.Format(EnvironmentSecurity.QuotedModel, m)).join(EnvironmentSecurity.ListSeparator);
                    throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ConflictingEdgeConcept, edge.Concept, deliveries,
                        MessageFormat.Format(EnvironmentSecurity.ConflictingEdgeMessage, edge.Concept, EnvironmentCatalogError.DeliveredBy(deliveries), named));
                }
                unique.set(edge.Concept, edge);
            }
        }
        return [...unique.values()].sort((a, b) => (a.Concept < b.Concept ? -1 : a.Concept > b.Concept ? 1 : 0));
    }
}
