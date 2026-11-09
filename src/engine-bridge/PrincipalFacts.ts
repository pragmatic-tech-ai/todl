import type { Scalar } from '../manifest/logical.js';

/**
 * What a policy may ask about the acting principal: named facts (claims, groups, ...). TODL-declared and
 * identity-free; the host adapts its own principal to this shape. An absent fact reads as undefined.
 */
export interface IPrincipalFacts
{
    /** The principal's stable id (for diagnostics and caching; policies do not read it). */
    readonly Id: string;
    /** The fact called `name`: a scalar, a list of scalars (e.g. groups), or undefined when absent. */
    Get(name: string): Scalar | readonly Scalar[] | undefined;
}
