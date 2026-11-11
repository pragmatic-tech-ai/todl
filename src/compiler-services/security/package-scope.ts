import { MetaKind } from '../model/kinds.js';
import type { Repository } from '../model/model.js';
import type { SourceSpan } from '../diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../diagnostics/diagnostic.js';
import { MessageTemplate } from '../diagnostics/message-template.js';

/**
 * A package's security scope (spec §4.3): a package may secure only its own concepts. An "own concept" is a
 * `MetaKind.Concept` node whose id is not among `seededIds` (the merged foundation and bases), so a dependency's,
 * the prelude's and `todl.system`'s concepts are foreign. Shared by every rule that names concepts.
 */
export class PackageScope
{
    private static readonly ForeignConceptMessage = 'security declaration on "{0}", which this package does not declare; a package may secure only its own concepts';

    public constructor(
        private readonly model: Repository,
        private readonly seededIds: ReadonlySet<string>,
    )
    {
    }

    /** True when `concept` is a concept node this compile declares. */
    public IsOwnConcept(concept: string): boolean
    {
        return !this.seededIds.has(concept) && this.model.resolve(concept)?.metaKind === MetaKind.Concept;
    }

    /** Report `security.foreign-concept` on `span` when `concept` is not an own concept; true when it reported. */
    public ReportIfForeign(concept: string, span: SourceSpan | null, node: string, sink: Diagnostic[]): boolean
    {
        if (this.IsOwnConcept(concept))
        {
            return false;
        }
        sink.push({
            code: DiagnosticCode.SecurityForeignConcept, severity: Severity.Error,
            message: MessageTemplate.Format(PackageScope.ForeignConceptMessage, concept),
            span, node, path: concept,
        });
        return true;
    }
}
