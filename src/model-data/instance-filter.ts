import type { Scalar } from "../manifest/logical.js";

/** A minimal read lens over one instance, for access-filtering. todl-identity-free. */
export interface IInstanceView
{
    readonly Concept: string;
    Field(name: string): Scalar | undefined;
}

/** A per-request access filter: return false to drop an instance from reads. */
export interface IInstanceFilter
{
    Keep(view: IInstanceView): boolean;
}
