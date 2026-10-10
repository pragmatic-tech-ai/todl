import {
    PolicyNodeKind,
    PolicyRefRoot,
    PolicyBoolOp,
    PolicyCompareOp,
    type PolicyPredicate,
    type PolicyOperand,
    type PolicyRef,
} from "./policy-predicate.js";

export class PolicyPredicateCodec
{
    private static readonly BadShape = "invalid policy predicate JSON";

    public static ToJson(predicate: PolicyPredicate): string
    {
        return JSON.stringify(predicate);
    }

    public static FromJson(json: string): PolicyPredicate
    {
        return PolicyPredicateCodec.RevivePredicate(JSON.parse(json));
    }

    private static Fail(detail: string): Error
    {
        return new Error(`${PolicyPredicateCodec.BadShape}: ${detail}`);
    }

    private static AsRecord(raw: unknown): Record<string, unknown>
    {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        {
            throw PolicyPredicateCodec.Fail("expected an object");
        }
        return raw as Record<string, unknown>;
    }

    private static RevivePredicate(raw: unknown): PolicyPredicate
    {
        const node = PolicyPredicateCodec.AsRecord(raw);
        switch (node.kind)
        {
            case PolicyNodeKind.Compare:
                return {
                    kind: PolicyNodeKind.Compare,
                    op: PolicyPredicateCodec.ReviveCompareOp(node.op),
                    left: PolicyPredicateCodec.ReviveOperand(node.left),
                    right: PolicyPredicateCodec.ReviveOperand(node.right),
                };
            case PolicyNodeKind.Membership:
                return {
                    kind: PolicyNodeKind.Membership,
                    collection: PolicyPredicateCodec.ReviveRef(node.collection),
                    item: PolicyPredicateCodec.ReviveOperand(node.item),
                };
            case PolicyNodeKind.Bool:
                if (node.op !== PolicyBoolOp.And && node.op !== PolicyBoolOp.Or)
                {
                    throw PolicyPredicateCodec.Fail("bad bool op");
                }
                return {
                    kind: PolicyNodeKind.Bool,
                    op: node.op,
                    left: PolicyPredicateCodec.RevivePredicate(node.left),
                    right: PolicyPredicateCodec.RevivePredicate(node.right),
                };
            case PolicyNodeKind.Not:
                return { kind: PolicyNodeKind.Not, operand: PolicyPredicateCodec.RevivePredicate(node.operand) };
            default:
                throw PolicyPredicateCodec.Fail("unrecognized predicate kind");
        }
    }

    private static ReviveCompareOp(raw: unknown): PolicyCompareOp
    {
        if (raw !== PolicyCompareOp.Eq && raw !== PolicyCompareOp.Neq)
        {
            throw PolicyPredicateCodec.Fail("bad compare op");
        }
        return raw;
    }

    private static ReviveOperand(raw: unknown): PolicyOperand
    {
        const node = PolicyPredicateCodec.AsRecord(raw);
        if (node.kind === PolicyNodeKind.Ref)
        {
            return PolicyPredicateCodec.ReviveRef(raw);
        }
        if (node.kind === PolicyNodeKind.Literal)
        {
            const value = node.value;
            if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
            {
                throw PolicyPredicateCodec.Fail("bad literal value");
            }
            return { kind: PolicyNodeKind.Literal, value };
        }
        throw PolicyPredicateCodec.Fail("unrecognized operand kind");
    }

    private static ReviveRef(raw: unknown): PolicyRef
    {
        const node = PolicyPredicateCodec.AsRecord(raw);
        if (node.kind !== PolicyNodeKind.Ref)
        {
            throw PolicyPredicateCodec.Fail("expected a reference");
        }
        if (node.root !== PolicyRefRoot.Principal && node.root !== PolicyRefRoot.Entity)
        {
            throw PolicyPredicateCodec.Fail("bad reference root");
        }
        if (typeof node.member !== "string")
        {
            throw PolicyPredicateCodec.Fail("bad reference member");
        }
        return { kind: PolicyNodeKind.Ref, root: node.root, member: node.member };
    }
}
