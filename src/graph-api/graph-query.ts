import type { TypeInfo, IInstanceMirror, TermInfo, ReflectedNode } from "../manifest/reflection/reflection.js";

// The read-only query contract, now reflection-native: methods return live reflection
// handles (TypeInfo / IInstanceMirror / TermInfo). Callers project to serializable DTOs
// with the Snapshot class. Any backing (a composed DomainHost, later an HTTP proxy over
// snapshots) can satisfy it.
export interface IGraphQuery
{
    Concepts(): TypeInfo[];
    Type(name: string): TypeInfo | undefined;
    InstancesOf(conceptId: string): IInstanceMirror[];
    Reflect(id: string): IInstanceMirror | undefined;
    Refs(id: string, member: string): IInstanceMirror[];
    Referrers(id: string, member?: string): IInstanceMirror[];
    Search(text: string): IInstanceMirror[];
    AllInstances(): IInstanceMirror[];
    Term(id: string): TermInfo | undefined;
    Narrower(termId: string): TermInfo[];
    Broader(termId: string): TermInfo[];
    Descendants(termId: string): TermInfo[];
    Ancestors(termId: string): TermInfo[];
    /** The qualified resource uri (`<model>/<version>/<path>`) of a type's `icon` annotation,
     *  resolved against the DECLARING manifest; undefined when the type has no icon. */
    IconKey(typeId: string): string | undefined;
    /** Optional: a mirror for a reflected node that is NOT (yet) in this graph (e.g. an uncommitted write), decorated
     *  exactly as this graph decorates its own mirrors. undefined when the node's type is not known here. A decorator
     *  must implement this only if it applies its own decoration (masking, filtering) to the result; one that cannot
     *  must leave it undefined so callers fall back rather than receive an undecorated mirror. */
    Materialize?(node: ReflectedNode): IInstanceMirror | undefined;
}
