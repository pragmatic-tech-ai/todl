import { Builder } from '../model/builder.js';
import { Direction, EdgeKind, Tier, type Node } from '../model/graph.js';
import { MetaKind } from '../model/kinds.js';
import { Repository } from '../model/model.js';
import type { SourceSpan } from '../diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import { FieldSecurityRules } from './field-security-rules.js';
import { ReifiedOperators } from './reified-operators.js';
import { SecurityNames } from './security-names.js';
import type { ISecurityRule } from './security-validator.js';

/**
 * The rules over the system ownership fields (`owner`, `owningBusinessUnit`) of owned concepts, judged over the
 * compile's own nodes (ids not in `seededIds`). The engine bridge maintains these fields, so a package may not
 * declare (redeclare, retype, shadow), derive, annotate or write them for any type carrying `todl.system.Owned`. An
 * owned concept is never a reified edge concept, and a `populate` never binds an owned concept or one with a secured
 * field (connector data is outside the model). The language has no rename, so "declared" covers it.
 */
export class SystemFieldRules implements ISecurityRule
{
    private static readonly DeclaredMessage = '"{0}" declares system field "{1}"; a type carrying {2} may not declare it';
    private static readonly ShadowedMessage = '"{0}" carries {1} and takes system field "{2}" from "{3}"; a system field may not be shadowed';
    private static readonly DerivedMessage = '"{0}" derives system field "{1}"; the system maintains it';
    private static readonly AnnotatedMessage = '"{0}" annotates system field "{1}"; a package may not shape system fields';
    private static readonly WrittenMessage = '"{0}" assigns system field "{1}"; the system maintains it';
    private static readonly OwnedEdgeMessage = 'edge concept "{0}" (targeted by reified operator "{1}") carries {2}; an edge concept is never owned';
    private static readonly ExternalMessage = 'populate binds "{0}", which is owned or has a secured field; connector data cannot carry ownership or secured fields';

    private readonly fields: FieldSecurityRules;

    public constructor(
        private readonly model: Repository,
        private readonly seededIds: ReadonlySet<string>,
    )
    {
        this.fields = new FieldSecurityRules(model, seededIds);
    }

    public Validate(sink: Diagnostic[]): void
    {
        for (const node of this.model.allNodes())
        {
            if (this.seededIds.has(node.id) || node.canonicalId != null)
            {
                continue;
            }
            if (node.tier === Tier.Instance)
            {
                this.ValidateInstance(node, sink);
                continue;
            }
            switch (node.metaKind)
            {
                case MetaKind.Concept:
                    this.ValidateType(node, sink);
                    this.ValidateDerives(node, sink);
                    this.ValidateEdgeConcept(node, sink);
                    break;
                case MetaKind.Aspect:
                    this.ValidateType(node, sink);
                    break;
                case MetaKind.MemberTarget:
                    this.ValidateMemberTarget(node, sink);
                    break;
                case MetaKind.Population:
                    this.ValidatePopulation(node, sink);
                    break;
            }
        }
    }

    private IsOwned(type: string): boolean
    {
        return this.model.IsA(type, SecurityNames.OwnedAspect);
    }

    /** The system fields `type` declares itself, as a field or a relationship. */
    private DeclaredSystemFields(type: string): string[]
    {
        const schema = this.model.schemaOf(type);
        return [...schema.fields.map((f) => f.name), ...schema.relationships.map((r) => r.name)].filter((name) => SecurityNames.IsSystemField(name));
    }

    /**
     * An owned type's own system-field declarations, plus those it takes from a contributor (supertype or carried
     * aspect) that is not owned itself (a contributor that is owned reports its own declaration). `Owned` itself, the
     * fields' one home, is exempt (it is own only when compiling `todl.system`).
     */
    private ValidateType(node: Node, sink: Diagnostic[]): void
    {
        if (node.id === SecurityNames.OwnedAspect || !this.IsOwned(node.id))
        {
            return;
        }
        for (const name of this.DeclaredSystemFields(node.id))
        {
            this.Report(sink, DiagnosticCode.SecuritySystemFieldDeclared, MessageTemplate.Format(SystemFieldRules.DeclaredMessage, node.id, name, SecurityNames.OwnedAspect),
                this.model.spanOf(Repository.memberKey(node.id, name)) ?? this.model.spanOf(node.id), node.id, name);
        }
        const contributors = node.metaKind === MetaKind.Concept
            ? [...this.model.supertypesOf(node.id), ...this.model.AspectsOf(node.id)]
            : this.model.closure(node.id, EdgeKind.IncludesAspect, Direction.Out, false);
        for (const contributor of new Set(contributors))
        {
            if (contributor === node.id || this.IsOwned(contributor))
            {
                continue;
            }
            for (const name of this.DeclaredSystemFields(contributor))
            {
                this.Report(sink, DiagnosticCode.SecuritySystemFieldDeclared,
                    MessageTemplate.Format(SystemFieldRules.ShadowedMessage, node.id, SecurityNames.OwnedAspect, name, contributor),
                    this.model.spanOf(node.id), node.id, name);
            }
        }
    }

    private ValidateDerives(node: Node, sink: Diagnostic[]): void
    {
        if (!this.IsOwned(node.id))
        {
            return;
        }
        for (const derive of this.model.DerivesOf(node.id))
        {
            if (SecurityNames.IsSystemField(derive.member))
            {
                this.Report(sink, DiagnosticCode.SecuritySystemFieldDerived, MessageTemplate.Format(SystemFieldRules.DerivedMessage, node.id, derive.member),
                    this.model.spanOf(Repository.deriveKey(node.id, derive.member)) ?? this.model.spanOf(node.id), node.id, derive.member);
            }
        }
    }

    private ValidateEdgeConcept(node: Node, sink: Diagnostic[]): void
    {
        if (!this.IsOwned(node.id))
        {
            return;
        }
        const glyph = ReifiedOperators.Targeting(this.model, node.id)[0];
        if (glyph !== undefined)
        {
            this.Report(sink, DiagnosticCode.SecurityOwnedEdgeConcept, MessageTemplate.Format(SystemFieldRules.OwnedEdgeMessage, node.id, glyph, SecurityNames.OwnedAspect),
                this.model.spanOf(glyph) ?? this.model.spanOf(node.id), node.id, glyph);
        }
    }

    /** A `member owner { annotate … }` block: the member target of an owned type naming a system field. */
    private ValidateMemberTarget(node: Node, sink: Diagnostic[]): void
    {
        const name = String(node.attrs.get(Builder.MemberTargetNameAttr));
        const owner = Builder.MemberTargetOwner(node.id, name);
        if (!SecurityNames.IsSystemField(name) || !this.IsOwned(owner))
        {
            return;
        }
        const application = this.model.related(node.id, EdgeKind.Annotated, Direction.Out)[0];
        const span = (application === undefined ? null : this.model.spanOf(application)) ?? this.model.spanOf(owner);
        this.Report(sink, DiagnosticCode.SecuritySystemFieldAnnotated, MessageTemplate.Format(SystemFieldRules.AnnotatedMessage, owner, name), span, owner, name);
    }

    /** An instance, class or inline object of an owned type assigning a system field (attr or relationship edge). */
    private ValidateInstance(node: Node, sink: Diagnostic[]): void
    {
        if (node.type === null || !this.IsOwned(node.type))
        {
            return;
        }
        for (const name of SecurityNames.SystemFields)
        {
            const assigned = node.attrs.has(name)
                || this.model.related(node.id, EdgeKind.Relationship, Direction.Out, name).length > 0;
            if (assigned)
            {
                this.Report(sink, DiagnosticCode.SecuritySystemFieldWritten, MessageTemplate.Format(SystemFieldRules.WrittenMessage, node.id, name),
                    this.model.spanOf(Repository.memberKey(node.id, name)) ?? this.model.spanOf(node.id), node.id, name);
            }
        }
    }

    private ValidatePopulation(node: Node, sink: Diagnostic[]): void
    {
        const concept = String(node.attrs.get(Builder.BindingConceptAttr));
        const secured = this.model.effectiveSchema(concept).fields.some((f) => this.fields.IsSecured(concept, f.name));
        if (this.IsOwned(concept) || secured)
        {
            this.Report(sink, DiagnosticCode.SecurityExternalConcept, MessageTemplate.Format(SystemFieldRules.ExternalMessage, concept),
                this.model.spanOf(node.id), node.id, concept);
        }
    }

    private Report(sink: Diagnostic[], code: DiagnosticCode, message: string, span: SourceSpan | null, node: string, path: string): void
    {
        sink.push({ code, severity: Severity.Error, message, span, node, path });
    }
}
