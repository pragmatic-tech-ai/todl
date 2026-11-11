import { DeclKind, type ConceptPrivileges, type ContributionDecl, type PrivilegeEntry, type ProfileDecl, type RoleDecl } from '../parse/ast.js';
import { NodeIdQualifier } from '../parse/node-id-qualifier.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import type { Builder } from '../model/builder.js';
import type { Resolver } from '../resolve/resolver.js';
import type { SourceSpan } from '../diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import { BaseRoleName, SecurityTerms } from './security-terms.js';
import type { ISecurityPrivilege } from './package-security.js';

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
    public readonly Privileges: ISecurityPrivilege[] = [];
    public readonly Written = new Set<string>();

    protected constructor(public readonly Id: string, public readonly Ns: string, public readonly Uri: string)
    {
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

/**
 * Lowers `role` and `contribute` declarations to `MetaKind.Role` / `MetaKind.RoleContribution` nodes. Concept
 * references are resolved here: an unknown or foreign concept is diagnosed and its block dropped; an unknown action or
 * depth, or a privilege written twice, is diagnosed and the entry dropped. Rules over the lowered nodes (ownership,
 * edge concepts) run later in `PrivilegeRules`, which reads the spans recorded here.
 */
export class SecurityLowering
{
    private static readonly RoleSuffix = '@role';
    private static readonly ContributionSuffix = '@contribution';
    private static readonly SpanKeyTemplate = '{0}#privilege:{1}:{2}:{3}';
    private static readonly ConceptPart = 'concept';
    private static readonly DepthPart = 'depth';
    private static readonly UnknownConceptMessage = 'security privilege references unknown concept "{0}"';
    private static readonly ForeignConceptMessage = 'security privilege on "{0}", which this package does not declare; a package may grant privileges only on its own concepts';
    private static readonly UnknownActionMessage = '"{0}" is not a security action';
    private static readonly UnknownDepthMessage = '"{0}" is not a security depth';
    private static readonly UnknownBaseRoleMessage = '"{0}" is not a base role (BasicUser or Reader)';
    private static readonly SystemAdministratorMessage = 'SystemAdministrator bypasses every check; a contribution to it is meaningless';
    private static readonly ShadowsBaseRoleMessage = 'role "{0}" shadows the base role of that name; use "contribute {0}"';
    private static readonly DuplicateRoleMessage = 'role "{0}" is declared more than once';
    private static readonly DuplicatePrivilegeMessage = '"{0}" on "{1}" is written more than once';

    private readonly owners = new Map<string, PrivilegeOwner>();
    private readonly roleNames = new Set<string>();

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
                    break;
            }
        }
        const homes: ISecurityHome[] = [];
        const builder = this.model.builder();
        for (const owner of this.owners.values())
        {
            if (this.model.has(owner.Id))
            {
                continue;
            }
            builder.setNamespace(owner.Ns);
            owner.Define(builder);
            homes.push({ Id: owner.Id, Uri: owner.Uri });
        }
        builder.commit();
        return homes;
    }

    private LowerRole(unit: ISecurityUnit, decl: RoleDecl): void
    {
        const span = decl.nameSpan ?? decl.span;
        if (SecurityTerms.BaseRoleOf(decl.name) !== undefined)
        {
            this.Report(DiagnosticCode.SecurityRoleShadowsBaseRole, MessageTemplate.Format(SecurityLowering.ShadowsBaseRoleMessage, decl.name), span, decl.name);
            return;
        }
        if (this.roleNames.has(decl.name))
        {
            this.Report(DiagnosticCode.SecurityDuplicateRole, MessageTemplate.Format(SecurityLowering.DuplicateRoleMessage, decl.name), span, decl.name);
            return;
        }
        this.roleNames.add(decl.name);
        const id = NodeIdQualifier.Qualify(unit.ns, decl.name) + SecurityLowering.RoleSuffix;
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
            this.Report(DiagnosticCode.SecurityUnknownBaseRole, MessageTemplate.Format(SecurityLowering.UnknownBaseRoleMessage, decl.baseRole), span, decl.baseRole);
            return;
        }
        if (baseRole === BaseRoleName.SystemAdministrator)
        {
            this.Report(DiagnosticCode.SecuritySystemAdministratorContribution, SecurityLowering.SystemAdministratorMessage, span, decl.baseRole);
            return;
        }
        const id = NodeIdQualifier.Qualify(unit.ns, baseRole) + SecurityLowering.ContributionSuffix;
        let owner = this.owners.get(id);
        if (owner === undefined)
        {
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

    /** The qualified id of `block`'s concept, or undefined (diagnosed) when it is unknown or not the package's own. */
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
        if (!this.resolver.Defines(id))
        {
            this.Report(DiagnosticCode.SecurityForeignConcept, MessageTemplate.Format(SecurityLowering.ForeignConceptMessage, id), span, owner.Id);
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
        const written = JSON.stringify([concept, action]);
        if (owner.Written.has(written))
        {
            this.Report(DiagnosticCode.SecurityDuplicatePrivilege, MessageTemplate.Format(SecurityLowering.DuplicatePrivilegeMessage, action, concept), entry.actionSpan ?? entry.span, owner.Id);
            return;
        }
        owner.Written.add(written);
        owner.Privileges.push({ Concept: concept, Action: action, Depth: depth });
        this.model.recordSpan(SecurityLowering.ConceptSpanKey(owner.Id, concept, action), block.conceptSpan ?? block.span);
        this.model.recordSpan(SecurityLowering.DepthSpanKey(owner.Id, concept, action), entry.depthSpan ?? entry.span);
    }

    private Report(code: DiagnosticCode, message: string, span: SourceSpan, node: string): void
    {
        this.diagnostics.push({ code, severity: Severity.Error, message, span, node, path: null });
    }
}
