import { PolicyPredicateCodec } from "./policy-predicate-codec.js";
import type { PolicyPredicate } from "./policy-predicate.js";

export enum PolicyEffect
{
    Allow = 1,
    Deny,
}

export enum PolicyAction
{
    Read = 1,
    Write,
}

/** One `allow|deny read|write when <predicate>` rule of a policy. */
export interface PolicyRule
{
    readonly Effect: PolicyEffect;
    readonly Action: PolicyAction;
    readonly Predicate: PolicyPredicate;
}

interface SerializedRule
{
    readonly effect: string;
    readonly action: string;
    readonly predicate: unknown;
}

/** Reads the rules a `<concept>@policy` node stores (its `rules` attribute): engine-free and host-free. */
export class PolicyRules
{
    private static readonly AllowToken = "allow";
    private static readonly DenyToken = "deny";
    private static readonly ReadToken = "read";
    private static readonly WriteToken = "write";
    private static readonly NotAnArray = "policy rules are not a JSON array";
    private static readonly EffectMessage = "unknown policy effect \"";
    private static readonly ActionMessage = "unknown policy action \"";
    private static readonly Quote = "\"";

    /** The rules in `json`. Throws an Error naming the problem when the JSON or a rule is malformed. */
    public static Parse(json: string): readonly PolicyRule[]
    {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed))
        {
            throw new Error(PolicyRules.NotAnArray);
        }
        return (parsed as SerializedRule[]).map((entry) => ({
            Effect: PolicyRules.EffectOf(entry.effect),
            Action: PolicyRules.ActionOf(entry.action),
            Predicate: PolicyPredicateCodec.FromJson(JSON.stringify(entry.predicate)),
        }));
    }

    private static EffectOf(token: string): PolicyEffect
    {
        if (token === PolicyRules.AllowToken) return PolicyEffect.Allow;
        if (token === PolicyRules.DenyToken) return PolicyEffect.Deny;
        throw new Error(PolicyRules.EffectMessage + token + PolicyRules.Quote);
    }

    private static ActionOf(token: string): PolicyAction
    {
        if (token === PolicyRules.ReadToken) return PolicyAction.Read;
        if (token === PolicyRules.WriteToken) return PolicyAction.Write;
        throw new Error(PolicyRules.ActionMessage + token + PolicyRules.Quote);
    }
}
