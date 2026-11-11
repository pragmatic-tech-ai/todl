import { Builder } from '../model/builder.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import { ReifiedOperators } from './reified-operators.js';
import { SecurityNames } from './security-names.js';
import type { IFieldProfile, IFieldProfileEntry, IPackageRole, IPackageSecurity, ISecuredField, ISecurityPrivilege } from './package-security.js';

/** Compiles the security surface of a clean compile: the own roles, contributions, secured fields, profiles and edge concepts. */
export class PackageSecurityCompiler
{
    private static readonly NameSeparator = '.';

    private constructor()
    {
    }

    /** The package's security from a clean compile: own nodes only, names qualified by `packageId`. */
    public static Compile(model: Repository, ownIds: ReadonlySet<string>, packageId: string): IPackageSecurity
    {
        const own = (id: string): boolean => ownIds.has(id);
        const concepts = model.nodesOfMetaKind(MetaKind.Concept).filter(own);
        const ownedConcepts = concepts.filter((id) => model.IsA(id, SecurityNames.OwnedAspect)).sort(PackageSecurityCompiler.Compare);

        const securedFields: ISecuredField[] = [];
        for (const id of concepts)
        {
            for (const field of model.resolve(id)?.fields ?? [])
            {
                if (field.secured === true)
                {
                    securedFields.push({ Concept: id, Field: field.name });
                }
            }
        }

        const roles: IPackageRole[] = [];
        for (const id of model.nodesOfMetaKind(MetaKind.Role).filter(own))
        {
            const node = model.resolve(id)!;
            roles.push({
                Name: packageId + PackageSecurityCompiler.NameSeparator + String(node.attrs.get(Builder.RoleNameAttr)),
                Privileges: PackageSecurityCompiler.SortPrivileges(JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))) as ISecurityPrivilege[]),
            });
        }

        const merged = new Map<string, ISecurityPrivilege[]>();
        for (const id of model.nodesOfMetaKind(MetaKind.RoleContribution).filter(own))
        {
            const node = model.resolve(id)!;
            const name = String(node.attrs.get(Builder.ContributionRoleAttr));
            const list = merged.get(name) ?? [];
            list.push(...(JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))) as ISecurityPrivilege[]));
            merged.set(name, list);
        }
        const contributions: IPackageRole[] = [...merged].map(([Name, privileges]) => ({ Name, Privileges: PackageSecurityCompiler.SortPrivileges(privileges) }));

        const profiles: IFieldProfile[] = [];
        for (const id of model.nodesOfMetaKind(MetaKind.FieldProfile).filter(own))
        {
            const node = model.resolve(id)!;
            const fields = JSON.parse(String(node.attrs.get(Builder.ProfileFieldsAttr))) as IFieldProfileEntry[];
            profiles.push({
                Name: packageId + PackageSecurityCompiler.NameSeparator + String(node.attrs.get(Builder.ProfileNameAttr)),
                Fields: [...fields].sort((a, b) => PackageSecurityCompiler.Compare(a.Concept, b.Concept) || PackageSecurityCompiler.Compare(a.Field, b.Field)),
            });
        }

        return {
            OwnedConcepts: ownedConcepts,
            Roles: roles.sort((a, b) => PackageSecurityCompiler.Compare(a.Name, b.Name)),
            BaseRoleContributions: contributions.sort((a, b) => PackageSecurityCompiler.Compare(a.Name, b.Name)),
            SecuredFields: securedFields.sort((a, b) => PackageSecurityCompiler.Compare(a.Concept, b.Concept) || PackageSecurityCompiler.Compare(a.Field, b.Field)),
            FieldProfiles: profiles.sort((a, b) => PackageSecurityCompiler.Compare(a.Name, b.Name)),
            EdgeConcepts: ReifiedOperators.Of(model).filter((e) => own(e.Concept)),
        };
    }

    /** True when the security surface has any entry. */
    public static IsEmpty(security: IPackageSecurity): boolean
    {
        return security.OwnedConcepts.length + security.Roles.length + security.BaseRoleContributions.length
            + security.SecuredFields.length + security.FieldProfiles.length + security.EdgeConcepts.length === 0;
    }

    private static SortPrivileges(privileges: readonly ISecurityPrivilege[]): ISecurityPrivilege[]
    {
        return [...privileges].sort((a, b) => PackageSecurityCompiler.Compare(a.Concept, b.Concept)
            || PackageSecurityCompiler.Compare(a.Action, b.Action) || PackageSecurityCompiler.Compare(a.Depth, b.Depth));
    }

    private static Compare(a: string, b: string): number
    {
        return a < b ? -1 : a > b ? 1 : 0;
    }
}
