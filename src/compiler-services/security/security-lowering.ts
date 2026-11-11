import { DeclKind, type ConceptPrivileges, type ContributionDecl, type PrivilegeEntry, type ProfileDecl, type ProfileEntry, type RoleDecl } from '../parse/ast.js';
import { NodeIdQualifier } from '../parse/node-id-qualifier.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import type { Builder } from '../model/builder.js';
import type { Resolver } from '../resolve/resolver.js';
import type { SourceSpan } from '../diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import { BaseRoleName, FieldProfileRight, SecurityTerms } from './security-terms.js';
import type { IFieldProfileEntry, ISecurityPrivilege } from './package-security.js';

/** One security declaration with the context it was written in (the loader's unit shape). */
export interface ISecurityUnit
{
    readonly ns: string;
    readonly imports: readonly string[];
    readonly uri: string;
    readonly decl: RoleDecl | ContributionDecl | ProfileDecl;
}

/** A node the lowering created and the source file it is homed to. */
export interface ISecurityHome
{
    readonly Id: string;
    readonly Uri: string;
}

/** A role or contribution node being assembled from one or more declarations. */
abstract class PrivilegeOwner
{
    private readonly privileges: ISecurityPrivilege[] = [];
    private readonly written = new Set<string>();

    protected constructor(public readonly Id: string, public readonly Ns: string, public readonly Uri: string)
    {
    }

    /** The privileges added so far, in source order. */
    public get Privileges(): readonly ISecurityPrivilege[]
    {
        return this.privileges;
    }

    /** Add `privilege`; false (nothing added) when this owner already has its (concept, action). */
    public Add(privilege: ISecurityPrivilege): boolean
    {
        const key = JSON.stringify([privilege.Concept, privilege.Action]);
        if (this.written.has(key))
        {
            return false;
        }
        this.written.add(key);
        this.privileges.push(privilege);
        return true;
    }

    /** Stage this owner's node on `builder`. */
    public abstract Define(builder: Builder): void;
}

class RoleOwner extends PrivilegeOwner
{
    public constructor(id: string, ns: string, uri: string, private readonly name: string)
    {
        super(id, ns, uri);
    }

    public Define(builder: Builder): void
    {
        builder.DefineRole(this.Id, this.name, JSON.stringify(this.Privileges));
    }
}

class ContributionOwner extends PrivilegeOwner
{
    public constructor(id: string, ns: string, uri: string, private readonly baseRole: BaseRoleName)
    {
        super(id, ns, uri);
    }

    public Define(builder: Builder): void
    {
        builder.DefineRoleContribution(this.Id, this.baseRole, JSON.stringify(this.Privileges));
    }
}

/** A field profile being assembled from one declaration; an entry written twice for one field unions its rights. */
class ProfileOwner
{
    private readonly entries = new Map<string, IFieldProfileEntry>();

    public constructor(public readonly Id: string, public readonly Ns: string, public readonly Uri: string, private readonly name: string)
    {
    }

    /** Add `entry`, unioning its rights into an earlier entry for the same (concept, field); true when it is new. */
    public Add(entry: IFieldProfileEntry): boolean
    {
        const key = JSON.stringify([entry.Concept, entry.Field]);
        const existing = this.entries.get(key);
        if (existing === undefined)
        {
            this.entries.set(key, entry);
            return true;
        }
        this.entries.set(key, {
            Concept: entry.Concept, Field: entry.Field,
            Read: existing.Read || entry.Read, Update: existing.Update || entry.Update, Create: existing.Create || entry.Create,
        });
        return false;
    }

    /** Stage this profile's node on `builder`. */
    public Define(builder: Builder): void
    {
        builder.DefineFieldProfile(this.Id, this.name, JSON.stringify([...this.entries.values()]));
    }
}

/**
 * Lowers `role` and `contribute` declarations to `MetaKind.Role` / `MetaKind.RoleContribution` nodes. Concept
 * references are resolved here: an unknown concept is diagnosed and its block dropped; an unknown action or depth, or
 * a privilege written twice, is diagnosed and the entry dropped. Rules over the lowered nodes (package scope,
 * ownership, edge concepts) run later in `PrivilegeRules`, judged against the compile's seeded ids, and read the
 * spans recorded here.
 *
 * `profile` declarations lower to `MetaKind.FieldProfile` nodes. Each entry's concept and field are resolved here (an
 * entry naming a subconcept is stored against the concept that declares the field) and its rights mapped; package
 * scope, the secured check and write-without-read run later in `FieldSecurityRules`.
 */
export class SecurityLowering
{
    private static readonly RoleSuffix = '@role';
    private static readonly ContributionSuffix = '@contribution';
    private static readonly ProfileSuffix = '@profile';
    private static readonly ProfileSpanKeyTemplate = '{0}#profile:{1}:{2}:{3}';
    private static readonly FieldPart = 'field';
    private static readonly EntryPart = 'entry';
    private static readonly SpanKeyTemplate = '{0}#privilege:{1}:{2}:{3}';
    private static readonly ConceptPart = 'concept';
    private static readonly DepthPart = 'depth';
    private static readonly UnknownConceptMessage = 'security privilege references unknown concept "{0}"';
    private static readonly UnknownActionMessage = '"{0}" is not a security action';
    private static readonly UnknownDepthMessage = '"{0}" is not a security depth';
    private static readonly UnknownBaseRoleMessage = '"{0}" is not a base role ({1})';
    private static readonly ListSeparator = ', ';
    private static readonly SystemAdministratorMessage = 'SystemAdministrator bypasses every check; a contribution to it is meaningless';
    private static readonly ShadowsBaseRoleMessage = 'role "{0}" shadows the base role of that name; use "contribute {0}"';
    private static readonly DuplicateRoleMessage = 'role "{0}" is declared more than once';
    private static readonly ExistingRoleMessage = 'role "{0}" is already declared as "{1}" by a dependency';
    private static readonly ExistingContributionMessage = 'a contribution to "{0}" is already declared as "{1}" by a dependency';
    private static readonly DuplicatePrivilegeMessage = '"{0}" on "{1}" is written more than once';
    private static readonly UnknownProfileConceptMessage = 'field profile references unknown concept "{0}"';
    private static readonly UnknownProfileFieldMessage = '"{0}" has no field "{1}"';
    private static readonly UnknownProfileRightMessage = '"{0}" is not a profile right ({1})';
    private static readonly DuplicateProfileMessage = 'profile "{0}" is declared more than once';
    private static readonly ExistingProfileMessage = 'profile "{0}" is already declared as "{1}" by a dependency';

    private readonly owners = new Map<string, PrivilegeOwner>();
    private readonly roleNames = new Set<string>();
    private readonly profiles = new Map<string, ProfileOwner>();
    private readonly profileNames = new Set<string>();

    public constructor(
        private readonly model: Repository,
        private readonly resolver: Resolver,
        private readonly diagnostics: Diagnostic[],
    )
    {
    }

    /** The span key of a lowered privilege's concept word. */
    public static ConceptSpanKey(owner: string, concept: string, action: string): string
    {
        return MessageTemplate.Format(SecurityLowering.SpanKeyTemplate, owner, concept, action, SecurityLowering.ConceptPart);
    }

    /** The span key of a lowered privilege's depth word. */
    public static DepthSpanKey(owner: string, concept: string, action: string): string
    {
        return MessageTemplate.Format(SecurityLowering.SpanKeyTemplate, owner, concept, action, SecurityLowering.DepthPart);
    }

    /** The span key of a lowered profile entry's concept path. */
    public static ProfileConceptSpanKey(profile: string, concept: string, field: string): string
    {
        return MessageTemplate.Format(SecurityLowering.ProfileSpanKeyTemplate, profile, concept, field, SecurityLowering.ConceptPart);
    }

    /** The span key of a lowered profile entry's field name. */
    public static ProfileFieldSpanKey(profile: string, concept: string, field: string): string
    {
        return MessageTemplate.Format(SecurityLowering.ProfileSpanKeyTemplate, profile, concept, field, SecurityLowering.FieldPart);
    }

    /** The span key of a whole lowered profile entry. */
    public static ProfileEntrySpanKey(profile: string, concept: string, field: string): string
    {
        return MessageTemplate.Format(SecurityLowering.ProfileSpanKeyTemplate, profile, concept, field, SecurityLowering.EntryPart);
    }

    /** Lower `units` into the model; returns each created node with its home file. */
    public Lower(units: readonly ISecurityUnit[]): readonly ISecurityHome[]
    {
        for (const unit of units)
        {
            switch (unit.decl.kind)
            {
                case DeclKind.Role:
                    this.LowerRole(unit, unit.decl);
                    break;
                case DeclKind.Contribution:
                    this.LowerContribution(unit, unit.decl);
                    break;
                case DeclKind.Profile:
                    this.LowerProfile(unit, unit.decl);
                    break;
            }
        }
        const homes: ISecurityHome[] = [];
        const builder = this.model.builder();
        for (const owner of this.owners.values())
        {
            builder.setNamespace(owner.Ns);
            owner.Define(builder);
            homes.push({ Id: owner.Id, Uri: owner.Uri });
        }
        for (const profile of this.profiles.values())
        {
            builder.setNamespace(profile.Ns);
            profile.Define(builder);
            homes.push({ Id: profile.Id, Uri: profile.Uri });
        }
        builder.commit();
        return homes;
    }

    private LowerRole(unit: ISecurityUnit, decl: RoleDecl): void
    {
        const span = decl.nameSpan ?? decl.span;
        const id = NodeIdQualifier.Qualify(unit.ns, decl.name) + SecurityLowering.RoleSuffix;
        if (SecurityTerms.BaseRoleOf(decl.name) !== undefined)
        {
            this.Report(DiagnosticCode.SecurityRoleShadowsBaseRole, MessageTemplate.Format(SecurityLowering.ShadowsBaseRoleMessage, decl.name), span, id);
            return;
        }
        if (this.roleNames.has(decl.name))
        {
            this.Report(DiagnosticCode.SecurityDuplicateRole, MessageTemplate.Format(SecurityLowering.DuplicateRoleMessage, decl.name), span, id);
            return;
        }
        if (this.model.has(id))
        {
            this.Report(DiagnosticCode.SecurityDuplicateRole, MessageTemplate.Format(SecurityLowering.ExistingRoleMessage, decl.name, id), span, id);
            return;
        }
        this.roleNames.add(decl.name);
        const owner = new RoleOwner(id, unit.ns, unit.uri, decl.name);
        this.owners.set(id, owner);
        this.LowerConcepts(unit, owner, decl.concepts);
    }

    private LowerContribution(unit: ISecurityUnit, decl: ContributionDecl): void
    {
        const span = decl.baseRoleSpan ?? decl.span;
        const baseRole = SecurityTerms.BaseRoleOf(decl.baseRole);
        if (baseRole === undefined)
        {
            const known = Object.values(BaseRoleName).join(SecurityLowering.ListSeparator);
            this.Report(DiagnosticCode.SecurityUnknownBaseRole, MessageTemplate.Format(SecurityLowering.UnknownBaseRoleMessage, decl.baseRole, known), span, null);
            return;
        }
        const id = NodeIdQualifier.Qualify(unit.ns, baseRole) + SecurityLowering.ContributionSuffix;
        if (baseRole === BaseRoleName.SystemAdministrator)
        {
            this.Report(DiagnosticCode.SecuritySystemAdministratorContribution, SecurityLowering.SystemAdministratorMessage, span, id);
            return;
        }
        let owner = this.owners.get(id);
        if (owner === undefined)
        {
            if (this.model.has(id))
            {
                this.Report(DiagnosticCode.SecurityDuplicateRole, MessageTemplate.Format(SecurityLowering.ExistingContributionMessage, baseRole, id), span, id);
                return;
            }
            owner = new ContributionOwner(id, unit.ns, unit.uri, baseRole);
            this.owners.set(id, owner);
        }
        this.LowerConcepts(unit, owner, decl.concepts);
    }

    private LowerConcepts(unit: ISecurityUnit, owner: PrivilegeOwner, blocks: readonly ConceptPrivileges[]): void
    {
        for (const block of blocks)
        {
            const concept = this.ResolveConcept(unit, owner, block);
            if (concept === undefined)
            {
                continue;
            }
            for (const entry of block.entries)
            {
                this.LowerEntry(owner, concept, block, entry);
            }
        }
    }

    /**
     * The qualified id of `block`'s concept, or undefined (diagnosed) when it does not resolve to a concept. Foreign
     * concepts are kept: `PrivilegeRules` judges package scope against the compile's seeded ids.
     */
    private ResolveConcept(unit: ISecurityUnit, owner: PrivilegeOwner, block: ConceptPrivileges): string | undefined
    {
        const span = block.conceptSpan ?? block.span;
        const resolved = this.resolver.resolveRef(block.concept, { ns: unit.ns, imports: unit.imports });
        const id = resolved.kind === 'qualified' ? resolved.flat : resolved.kind === 'ok' ? block.concept : undefined;
        if (id === undefined || this.model.resolve(id)?.metaKind !== MetaKind.Concept)
        {
            this.Report(DiagnosticCode.SecurityUnknownConcept, MessageTemplate.Format(SecurityLowering.UnknownConceptMessage, block.concept), span, owner.Id);
            return undefined;
        }
        return id;
    }

    private LowerEntry(owner: PrivilegeOwner, concept: string, block: ConceptPrivileges, entry: PrivilegeEntry): void
    {
        const action = SecurityTerms.ActionOf(entry.action);
        if (action === undefined)
        {
            this.Report(DiagnosticCode.SecurityUnknownAction, MessageTemplate.Format(SecurityLowering.UnknownActionMessage, entry.action), entry.actionSpan ?? entry.span, owner.Id);
            return;
        }
        const depth = SecurityTerms.DepthOf(entry.depth);
        if (depth === undefined)
        {
            this.Report(DiagnosticCode.SecurityUnknownDepth, MessageTemplate.Format(SecurityLowering.UnknownDepthMessage, entry.depth), entry.depthSpan ?? entry.span, owner.Id);
            return;
        }
        if (!owner.Add({ Concept: concept, Action: action, Depth: depth }))
        {
            this.Report(DiagnosticCode.SecurityDuplicatePrivilege, MessageTemplate.Format(SecurityLowering.DuplicatePrivilegeMessage, action, concept), entry.actionSpan ?? entry.span, owner.Id);
            return;
        }
        this.model.recordSpan(SecurityLowering.ConceptSpanKey(owner.Id, concept, action), block.conceptSpan ?? block.span);
        this.model.recordSpan(SecurityLowering.DepthSpanKey(owner.Id, concept, action), entry.depthSpan ?? entry.span);
    }

    private LowerProfile(unit: ISecurityUnit, decl: ProfileDecl): void
    {
        const span = decl.nameSpan ?? decl.span;
        const id = NodeIdQualifier.Qualify(unit.ns, decl.name) + SecurityLowering.ProfileSuffix;
        if (this.profileNames.has(decl.name))
        {
            this.Report(DiagnosticCode.SecurityDuplicateProfile, MessageTemplate.Format(SecurityLowering.DuplicateProfileMessage, decl.name), span, id);
            return;
        }
        if (this.model.has(id))
        {
            this.Report(DiagnosticCode.SecurityDuplicateProfile, MessageTemplate.Format(SecurityLowering.ExistingProfileMessage, decl.name, id), span, id);
            return;
        }
        this.profileNames.add(decl.name);
        const profile = new ProfileOwner(id, unit.ns, unit.uri, decl.name);
        this.profiles.set(id, profile);
        for (const entry of decl.entries)
        {
            this.LowerProfileEntry(unit, profile, entry);
        }
    }

    /**
     * Resolve one profile entry to (declaring concept, field) and its rights; an unknown concept, field or right is
     * diagnosed and the entry dropped. Foreign concepts are kept: `FieldSecurityRules` judges package scope.
     */
    private LowerProfileEntry(unit: ISecurityUnit, profile: ProfileOwner, entry: ProfileEntry): void
    {
        const resolved = this.resolver.resolveRef(entry.concept, { ns: unit.ns, imports: unit.imports });
        const concept = resolved.kind === 'qualified' ? resolved.flat : resolved.kind === 'ok' ? entry.concept : undefined;
        if (concept === undefined || this.model.resolve(concept)?.metaKind !== MetaKind.Concept)
        {
            this.Report(DiagnosticCode.SecurityUnknownConcept, MessageTemplate.Format(SecurityLowering.UnknownProfileConceptMessage, entry.concept), entry.conceptSpan ?? entry.span, profile.Id);
            return;
        }
        const field = this.model.effectiveSchema(concept).fields.find((f) => f.name === entry.field);
        if (field === undefined)
        {
            this.Report(DiagnosticCode.SecurityProfileUnknownField, MessageTemplate.Format(SecurityLowering.UnknownProfileFieldMessage, concept, entry.field), entry.fieldSpan ?? entry.span, profile.Id);
            return;
        }
        const rights = new Set<FieldProfileRight>();
        for (const text of entry.rights)
        {
            const right = SecurityTerms.RightOf(text);
            if (right === undefined)
            {
                const known = Object.values(FieldProfileRight).join(SecurityLowering.ListSeparator);
                this.Report(DiagnosticCode.SecurityUnknownProfileRight, MessageTemplate.Format(SecurityLowering.UnknownProfileRightMessage, text, known), entry.span, profile.Id);
                return;
            }
            rights.add(right);
        }
        const declaring = field.declaredBy;
        const added = profile.Add({
            Concept: declaring, Field: field.name,
            Read: rights.has(FieldProfileRight.Read), Update: rights.has(FieldProfileRight.Update), Create: rights.has(FieldProfileRight.Create),
        });
        if (added)
        {
            this.model.recordSpan(SecurityLowering.ProfileConceptSpanKey(profile.Id, declaring, field.name), entry.conceptSpan ?? entry.span);
            this.model.recordSpan(SecurityLowering.ProfileFieldSpanKey(profile.Id, declaring, field.name), entry.fieldSpan ?? entry.span);
            this.model.recordSpan(SecurityLowering.ProfileEntrySpanKey(profile.Id, declaring, field.name), entry.span);
        }
    }

    private Report(code: DiagnosticCode, message: string, span: SourceSpan, node: string | null): void
    {
        this.diagnostics.push({ code, severity: Severity.Error, message, span, node, path: null });
    }
}
