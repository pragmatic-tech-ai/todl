import { Builder } from '../model/builder.js';
import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import type { ISecurityPrivilege } from './package-security.js';
import { ReifiedOperators } from './reified-operators.js';
import { SecurityDepth } from './security-terms.js';
import { SecurityLowering } from './security-lowering.js';
import { SecurityNames } from './security-names.js';
import type { ISecurityRule } from './security-validator.js';

/**
 * The rules over lowered role and contribution nodes that need the whole model (so they also see aspects and
 * operators that arrive through bases): an owner-scoped depth needs an `Owned` concept, an edge concept takes no
 * privileges, and an edge concept has one endpoint pair.
 */
export class PrivilegeRules implements ISecurityRule
{
    private static readonly OwnerScopedDepths: ReadonlySet<SecurityDepth> = new Set([SecurityDepth.User, SecurityDepth.BusinessUnit, SecurityDepth.BusinessUnitAndChildren]);
    private static readonly DepthRequiresOwnershipMessage = 'depth "{0}" needs an owned concept; "{1}" does not carry {2}, so it takes organization or none only';
    private static readonly EdgeConceptPrivilegeMessage = '"{0}" is a reified edge concept; edges carry no privileges';
    private static readonly EdgeEndpointsConflictMessage = 'operator "{0}" binds edge concept "{1}" to ({2}, {3}), but another operator binds it to ({4}, {5}); an edge concept has one endpoint pair';

    public constructor(
        private readonly model: Repository,
        private readonly seededIds: ReadonlySet<string>,
    )
    {
    }

    public Validate(sink: Diagnostic[]): void
    {
        for (const node of this.model.allNodes())
        {
            if ((node.metaKind === MetaKind.Role || node.metaKind === MetaKind.RoleContribution) && !this.seededIds.has(node.id))
            {
                this.ValidateOwner(node.id, JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))) as ISecurityPrivilege[], sink);
            }
        }
        this.ValidateEndpoints(sink);
    }

    private ValidateOwner(owner: string, privileges: readonly ISecurityPrivilege[], sink: Diagnostic[]): void
    {
        for (const privilege of privileges)
        {
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
                    span: this.model.spanOf(SecurityLowering.ConceptSpanKey(owner, privilege.Concept, privilege.Action)), node: owner, path: privilege.Concept,
                });
            }
        }
    }

    /** One diagnostic per edge concept whose reified operators disagree on the endpoint pair, on the first own operator that differs. */
    private ValidateEndpoints(sink: Diagnostic[]): void
    {
        const concepts = new Set(ReifiedOperators.Of(this.model).map((edge) => edge.Concept));
        for (const concept of concepts)
        {
            const glyphs = ReifiedOperators.Targeting(this.model, concept);
            const first = ReifiedOperators.EdgeOf(this.model, glyphs[0]!)!;
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
