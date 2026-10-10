export enum PolicyNodeKind { Ref, Literal, Compare, Membership, Bool, Not }
export enum PolicyRefRoot { Principal, Entity }
export enum PolicyBoolOp { And, Or }
export enum PolicyCompareOp { Eq, Neq }

export interface PolicyRef { kind: PolicyNodeKind.Ref; root: PolicyRefRoot; member: string; }
export interface PolicyLiteral { kind: PolicyNodeKind.Literal; value: string | number | boolean; }
export type PolicyOperand = PolicyRef | PolicyLiteral;

export interface PolicyCompare { kind: PolicyNodeKind.Compare; op: PolicyCompareOp; left: PolicyOperand; right: PolicyOperand; }
export interface PolicyMembership { kind: PolicyNodeKind.Membership; collection: PolicyRef; item: PolicyOperand; }
export interface PolicyBool { kind: PolicyNodeKind.Bool; op: PolicyBoolOp; left: PolicyPredicate; right: PolicyPredicate; }
export interface PolicyNot { kind: PolicyNodeKind.Not; operand: PolicyPredicate; }
export type PolicyPredicate = PolicyCompare | PolicyMembership | PolicyBool | PolicyNot;

export class PolicyPredicateMembers
{
    /** Every entity.<member> name referenced anywhere in the predicate. */
    public static EntityMembers(predicate: PolicyPredicate): readonly string[]
    {
        const out: string[] = [];
        PolicyPredicateMembers.Walk(predicate, out);
        return out;
    }

    private static Walk(node: PolicyPredicate, out: string[]): void
    {
        switch (node.kind)
        {
            case PolicyNodeKind.Compare:
                PolicyPredicateMembers.Collect(node.left, out);
                PolicyPredicateMembers.Collect(node.right, out);
                break;
            case PolicyNodeKind.Membership:
                PolicyPredicateMembers.Collect(node.collection, out);
                PolicyPredicateMembers.Collect(node.item, out);
                break;
            case PolicyNodeKind.Bool:
                PolicyPredicateMembers.Walk(node.left, out);
                PolicyPredicateMembers.Walk(node.right, out);
                break;
            case PolicyNodeKind.Not:
                PolicyPredicateMembers.Walk(node.operand, out);
                break;
        }
    }

    private static Collect(operand: PolicyOperand, out: string[]): void
    {
        if (operand.kind === PolicyNodeKind.Ref && operand.root === PolicyRefRoot.Entity)
        {
            out.push(operand.member);
        }
    }
}
