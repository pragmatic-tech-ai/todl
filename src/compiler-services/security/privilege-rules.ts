import { Builder } from '../model/builder.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import type { ISecurityPrivilege } from './package-security.js';
import { PackageScope } from './package-scope.js';
import { ReifiedOperators } from './reified-operators.js';
import { SecurityDepth } from './security-terms.js';
import { SecurityLowering } from './security-lowering.js';
import { SecurityNames } from './security-names.js';
import type { ISecurityRule } from './security-validator.js';

/**
 * The rules over lowered role and contribution nodes that need the whole model (so they also see aspects and
 * operators that arrive through bases): a privilege names an own concept, an owner-scoped depth needs an `Owned`
 * concept, an edge concept takes no privileges, and an edge concept has one endpoint pair.
 */
export class PrivilegeRules implements ISecurityRule
{
    private static readonly OwnerScopedDepths: ReadonlySet<SecurityDepth> = new Set([SecurityDepth.User, SecurityDepth.BusinessUnit, SecurityDepth.BusinessUnitAndChildren]);
    private static readonly DepthRequiresOwnershipMessage = 'depth "{0}" needs an owned concept; "{1}" does not carry {2}, so it takes organization or none only';
    private static readonly EdgeConceptPrivilegeMessage = '"{0}" is a reified edge concept; edges carry no privileges';
    private static readonly DuplicateContributionMessage = '"{0}" on "{1}" is already contributed to {2} in another namespace';
    private static readonly KeySeparator = '|';
    private static readonly EdgeEndpointsConflictMessage = 'operator "{0}" binds edge concept "{1}" to ({2}, {3}), but another operator binds it to ({4}, {5}); an edge concept has one endpoint pair';

    private readonly scope: PackageScope;

    public constructor(
        private readonly model: Repository,
        private readonly seededIds: ReadonlySet<string>,
    )
    {
        this.scope = new PackageScope(model, seededIds);
    }

    public Validate(sink: Diagnostic[]): void
    {
        const contributed = new Set<string>();
        for (const node of this.model.allNodes())
        {
            if ((node.metaKind === MetaKind.Role || node.metaKind === MetaKind.RoleContribution) && !this.seededIds.has(node.id))
            {
                if (node.metaKind === MetaKind.RoleContribution)
                {
                    this.ValidateCrossNamespace(node, contributed, sink);
                }
                this.ValidateOwner(node.id, JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))) as ISecurityPrivilege[], sink);
            }
        }
        this.ValidateEndpoints(sink);
    }

    /** A (base role, concept, action) contributed from two namespaces of one package is reported on the later entry, so the merged list is unique. */
    private ValidateCrossNamespace(node: { id: string; attrs: ReadonlyMap<string, unknown> }, contributed: Set<string>, sink: Diagnostic[]): void
    {
        const baseRole = String(node.attrs.get(Builder.ContributionRoleAttr));
        for (const privilege of JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))) as ISecurityPrivilege[])
        {
            const key = [baseRole, privilege.Concept, privilege.Action].join(PrivilegeRules.KeySeparator);
            if (!contributed.has(key))
            {
                contributed.add(key);
                continue;
            }
            sink.push({
                code: DiagnosticCode.SecurityDuplicatePrivilege, severity: Severity.Error,
                message: MessageTemplate.Format(PrivilegeRules.DuplicateContributionMessage, privilege.Action, privilege.Concept, baseRole),
                span: this.model.spanOf(SecurityLowering.ActionSpanKey(node.id, privilege.Concept, privilege.Action)), node: node.id, path: privilege.Concept,
            });
        }
    }

    private ValidateOwner(owner: string, privileges: readonly ISecurityPrivilege[], sink: Diagnostic[]): void
    {
        for (const privilege of privileges)
        {
            const conceptSpan = this.model.spanOf(SecurityLowering.ConceptSpanKey(owner, privilege.Concept, privilege.Action));
            if (this.scope.ReportIfForeign(privilege.Concept, conceptSpan, owner, sink))
            {
                continue;
            }
            if (PrivilegeRules.OwnerScopedDepths.has(privilege.Depth) && !this.model.IsA(privilege.Concept, SecurityNames.OwnedAspect))
            {
                sink.push({
                    code: DiagnosticCode.SecurityDepthRequiresOwnership, severity: Severity.Error,
                    message: MessageTemplate.Format(PrivilegeRules.DepthRequiresOwnershipMessage, privilege.Depth, privilege.Concept, SecurityNames.OwnedAspect),
                    span: this.model.spanOf(SecurityLowering.DepthSpanKey(owner, privilege.Concept, privilege.Action)), node: owner, path: privilege.Concept,
                });
            }
            if (ReifiedOperators.IsEdgeConcept(this.model, privilege.Concept))
            {
                sink.push({
                    code: DiagnosticCode.SecurityEdgeConceptPrivilege, severity: Severity.Error,
                    message: MessageTemplate.Format(PrivilegeRules.EdgeConceptPrivilegeMessage, privilege.Concept),
                    span: conceptSpan, node: owner, path: privilege.Concept,
                });
            }
        }
    }

    /**
     * One diagnostic per edge concept whose reified operators disagree on the endpoint pair, on the first own operator
     * that differs from the reference pair. The reference is the first seeded operator when a base binds the concept
     * (the base's pair is fixed), otherwise the first operator.
     */
    private ValidateEndpoints(sink: Diagnostic[]): void
    {
        const concepts = new Set(ReifiedOperators.Of(this.model).map((edge) => edge.Concept));
        for (const concept of concepts)
        {
            const glyphs = ReifiedOperators.Targeting(this.model, concept);
            const reference = glyphs.find((glyph) => this.seededIds.has(glyph)) ?? glyphs[0]!;
            const first = ReifiedOperators.EdgeOf(this.model, reference)!;
            const conflicting = glyphs.find((glyph) =>
            {
                const edge = ReifiedOperators.EdgeOf(this.model, glyph)!;
                return !this.seededIds.has(glyph) && (edge.From !== first.From || edge.To !== first.To);
            });
            if (conflicting === undefined)
            {
                continue;
            }
            const edge = ReifiedOperators.EdgeOf(this.model, conflicting)!;
            sink.push({
                code: DiagnosticCode.SecurityEdgeEndpointsConflict, severity: Severity.Error,
                message: MessageTemplate.Format(PrivilegeRules.EdgeEndpointsConflictMessage, conflicting, concept, edge.From, edge.To, first.From, first.To),
                span: this.model.spanOf(conflicting), node: conflicting, path: concept,
            });
        }
    }
}
