import type { Repository } from '../model/model.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { FieldSecurityRules } from './field-security-rules.js';
import { PrivilegeRules } from './privilege-rules.js';
import { SystemFieldRules } from './system-field-rules.js';

/** One family of whole-model security rules. */
export interface ISecurityRule
{
    Validate(sink: Diagnostic[]): void;
}

/**
 * Validates a compile's security surface after load, over the lowered nodes. `seededIds` are the ids of the merged
 * foundation and bases: an "own concept" is a `MetaKind.Concept` node whose id is not among them. It runs only in
 * checkAgainst (build and publish), so its diagnostics are build-only: the LSP SolutionGraph does not show them live.
 */
export class SecurityValidator
{
    private readonly rules: readonly ISecurityRule[];

    public constructor(model: Repository, seededIds: ReadonlySet<string>)
    {
        this.rules = [
            new PrivilegeRules(model, seededIds),
            new FieldSecurityRules(model, seededIds),
            new SystemFieldRules(model, seededIds),
        ];
    }

    public Validate(): Diagnostic[]
    {
        const sink: Diagnostic[] = [];
        for (const rule of this.rules)
        {
            rule.Validate(sink);
        }
        return sink;
    }
}
