import { Builder } from '../model/builder.js';
import type { Node } from '../model/graph.js';
import { MetaKind } from '../model/kinds.js';
import { Repository } from '../model/model.js';
import { TokenKind, tokenize } from '../parse/lexer.js';
import type { SourceSpan } from '../diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';
import type { IFieldProfileEntry } from './package-security.js';
import { PackageScope } from './package-scope.js';
import { SecurityLowering } from './security-lowering.js';
import type { ISecurityRule } from './security-validator.js';

/**
 * The rules over secured fields and field profiles, judged over the compile's own nodes (ids not in `seededIds`): a
 * field is secured only in a concept body; a secured field is never an identity key (`identity … key`, `match` rules)
 * nor read by a `derive` expression of its concept; a profile entry names a secured field of an own concept and never
 * grants a write without read (PR8). TODL has no unique-index declaration; a future one must consult `IsSecured`.
 */
export class FieldSecurityRules implements ISecurityRule
{
    private static readonly SecuredSpanSuffix = '#secured';
    private static readonly SecuredOnAspectMessage = '"{0}.{1}" is secured in an aspect body; only a concept field can be secured';
    private static readonly SecuredIdentityKeyMessage = 'identity key "{0}" of "{1}" is a secured field; a secured field cannot be an identity key';
    private static readonly SecuredMatchMemberMessage = 'match rule of "{0}" compares secured field "{1}"; a secured field cannot be an identity key';
    private static readonly SecuredInDeriveMessage = 'derive "{0}" of "{1}" reads secured field "{2}"; a derived value would leak it';
    private static readonly FieldNotSecuredMessage = 'profile "{0}" grants rights on "{1}.{2}", which is not a secured field';
    private static readonly WriteWithoutReadMessage = 'profile "{0}" grants update or create on "{1}.{2}" without read; a write needs read on the field';

    private readonly scope: PackageScope;

    public constructor(
        private readonly model: Repository,
        private readonly seededIds: ReadonlySet<string>,
    )
    {
        this.scope = new PackageScope(model, seededIds);
    }

    /** The span key of the `secured` modifier on `owner`'s field `member`. */
    public static SecuredSpanKey(owner: string, member: string): string
    {
        return Repository.memberKey(owner, member) + FieldSecurityRules.SecuredSpanSuffix;
    }

    /** The span key of the source naming field `member` as a key of the identity or match node `node`. */
    public static KeySpanKey(node: string, member: string): string
    {
        return Repository.memberKey(node, member);
    }

    /** True when `member` is a secured field of `concept`, declared on it or inherited from an ancestor. */
    public IsSecured(concept: string, member: string): boolean
    {
        const field = this.model.effectiveSchema(concept).fields.find((f) => f.name === member);
        if (field === undefined)
        {
            return false;
        }
        return this.model.resolve(field.declaredBy)?.fields.find((f) => f.name === member)?.secured === true;
    }

    public Validate(sink: Diagnostic[]): void
    {
        for (const node of this.model.allNodes())
        {
            if (this.seededIds.has(node.id))
            {
                continue;
            }
            switch (node.metaKind)
            {
                case MetaKind.Aspect:
                    this.ValidateAspect(node, sink);
                    break;
                case MetaKind.Identity:
                    this.ValidateIdentity(node, sink);
                    break;
                case MetaKind.Match:
                    this.ValidateMatch(node, sink);
                    break;
                case MetaKind.Concept:
                    this.ValidateDerives(node.id, sink);
                    break;
                case MetaKind.FieldProfile:
                    this.ValidateProfile(node, sink);
                    break;
            }
        }
    }

    private ValidateAspect(node: Node, sink: Diagnostic[]): void
    {
        for (const field of node.fields)
        {
            if (field.secured === true)
            {
                const span = this.model.spanOf(FieldSecurityRules.SecuredSpanKey(node.id, field.name)) ?? this.model.spanOf(Repository.memberKey(node.id, field.name));
                this.Report(sink, DiagnosticCode.SecuritySecuredOnAspect, MessageTemplate.Format(FieldSecurityRules.SecuredOnAspectMessage, node.id, field.name), span, node.id, field.name);
            }
        }
    }

    private ValidateIdentity(node: Node, sink: Diagnostic[]): void
    {
        const concept = String(node.attrs.get(Builder.IdentityConceptAttr));
        const key = String(node.attrs.get(Builder.IdentityKeyAttr));
        if (this.IsSecured(concept, key))
        {
            this.Report(sink, DiagnosticCode.SecuritySecuredIdentityKey, MessageTemplate.Format(FieldSecurityRules.SecuredIdentityKeyMessage, key, concept),
                this.model.spanOf(FieldSecurityRules.KeySpanKey(node.id, key)), node.id, key);
        }
    }

    private ValidateMatch(node: Node, sink: Diagnostic[]): void
    {
        const concept = String(node.attrs.get(Builder.MatchConceptAttr));
        const rules = JSON.parse(String(node.attrs.get(Builder.MatchRulesAttr))) as string[][];
        const secured = new Set(rules.flat().filter((field) => this.IsSecured(concept, field)));
        for (const field of secured)
        {
            this.Report(sink, DiagnosticCode.SecuritySecuredMatchMember, MessageTemplate.Format(FieldSecurityRules.SecuredMatchMemberMessage, concept, field),
                this.model.spanOf(FieldSecurityRules.KeySpanKey(node.id, field)), node.id, field);
        }
    }

    /** A derive leaks a secured member when its expression text names one as an identifier token. */
    private ValidateDerives(concept: string, sink: Diagnostic[]): void
    {
        for (const derive of this.model.DerivesOf(concept))
        {
            const leaked = tokenize(derive.expression).find((token) => token.kind === TokenKind.Identifier && this.IsSecured(concept, token.value));
            if (leaked !== undefined)
            {
                this.Report(sink, DiagnosticCode.SecuritySecuredInDerive, MessageTemplate.Format(FieldSecurityRules.SecuredInDeriveMessage, derive.member, concept, leaked.value),
                    this.model.spanOf(Repository.deriveKey(concept, derive.member)), concept, derive.member);
            }
        }
    }

    private ValidateProfile(node: Node, sink: Diagnostic[]): void
    {
        const name = String(node.attrs.get(Builder.ProfileNameAttr));
        const entries = JSON.parse(String(node.attrs.get(Builder.ProfileFieldsAttr))) as IFieldProfileEntry[];
        for (const entry of entries)
        {
            if (!this.IsSecured(entry.Concept, entry.Field))
            {
                this.Report(sink, DiagnosticCode.SecurityProfileFieldNotSecured, MessageTemplate.Format(FieldSecurityRules.FieldNotSecuredMessage, name, entry.Concept, entry.Field),
                    this.model.spanOf(SecurityLowering.ProfileFieldSpanKey(node.id, entry.Concept, entry.Field)), node.id, entry.Field);
                continue;
            }
            if (this.scope.ReportIfForeign(entry.Concept, this.model.spanOf(SecurityLowering.ProfileConceptSpanKey(node.id, entry.Concept, entry.Field)), node.id, sink))
            {
                continue;
            }
            if ((entry.Update || entry.Create) && !entry.Read)
            {
                this.Report(sink, DiagnosticCode.SecurityWriteWithoutRead, MessageTemplate.Format(FieldSecurityRules.WriteWithoutReadMessage, name, entry.Concept, entry.Field),
                    this.model.spanOf(SecurityLowering.ProfileEntrySpanKey(node.id, entry.Concept, entry.Field)), node.id, entry.Field);
            }
        }
    }

    private Report(sink: Diagnostic[], code: DiagnosticCode, message: string, span: SourceSpan | null, node: string, path: string): void
    {
        sink.push({ code, severity: Severity.Error, message, span, node, path });
    }
}
