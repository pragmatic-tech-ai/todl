import type { SecurityAction, SecurityDepth } from './security-terms.js';

/** One privilege a role grants: an action on a concept at a depth. */
export interface ISecurityPrivilege
{
    readonly Concept: string;
    readonly Action: SecurityAction;
    readonly Depth: SecurityDepth;
}

/** A role a package defines. */
export interface IPackageRole
{
    readonly Name: string;
    readonly Privileges: readonly ISecurityPrivilege[];
}

/** A field-level secured field. */
export interface ISecuredField
{
    readonly Concept: string;
    readonly Field: string;
}

/** The rights a profile grants on one secured field. */
export interface IFieldProfileEntry
{
    readonly Concept: string;
    readonly Field: string;
    readonly Read: boolean;
    readonly Update: boolean;
    readonly Create: boolean;
}

/** A named set of field rights. */
export interface IFieldProfile
{
    readonly Name: string;
    readonly Fields: readonly IFieldProfileEntry[];
}

/** A reified edge concept; From/To are the operator's endpoint member names. */
export interface IEdgeConcept
{
    readonly Concept: string;
    readonly From: string;
    readonly To: string;
}

/** The compiled security surface of a package. */
export interface IPackageSecurity
{
    readonly OwnedConcepts: readonly string[];
    readonly Roles: readonly IPackageRole[];
    readonly BaseRoleContributions: readonly IPackageRole[];
    readonly SecuredFields: readonly ISecuredField[];
    readonly FieldProfiles: readonly IFieldProfile[];
    readonly EdgeConcepts: readonly IEdgeConcept[];
}

export class PackageSecurity
{
    /** A package with no security surface. */
    public static readonly Empty: IPackageSecurity = Object.freeze({
        OwnedConcepts: Object.freeze([]),
        Roles: Object.freeze([]),
        BaseRoleContributions: Object.freeze([]),
        SecuredFields: Object.freeze([]),
        FieldProfiles: Object.freeze([]),
        EdgeConcepts: Object.freeze([]),
    });

    private constructor()
    {
    }
}
