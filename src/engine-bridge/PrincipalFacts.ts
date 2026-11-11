/**
 * The acting principal as the engine bridge sees it: identity-free; the host adapts its own principal to this shape.
 */
export interface IPrincipalFacts
{
    /** The acting principal's id (a user id or the environment's system principal id, C7). */
    readonly Id: string;
    /** The principal's home business unit id (C3: owningBusinessUnit on create). */
    readonly HomeBusinessUnitId: string;
}
