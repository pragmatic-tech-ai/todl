import type { TypeInfo, InstanceMirror, TermInfo } from "../manifest/reflection/reflection.js";

// The read-only query contract, now reflection-native: methods return live reflection
// handles (TypeInfo / InstanceMirror / TermInfo). Callers project to serializable DTOs
// with the Snapshot class. Any backing (a composed DomainHost, later an HTTP proxy over
// snapshots) can satisfy it.
export interface IGraphQuery
{
    Concepts(): TypeInfo[];
    Type(name: string): TypeInfo | undefined;
    InstancesOf(conceptId: string): InstanceMirror[];
    Reflect(id: string): InstanceMirror | undefined;
    Refs(id: string, member: string): InstanceMirror[];
    Referrers(id: string, member?: string): InstanceMirror[];
    Search(text: string): InstanceMirror[];
    Term(id: string): TermInfo | undefined;
    Narrower(termId: string): TermInfo[];
    Broader(termId: string): TermInfo[];
    Descendants(termId: string): TermInfo[];
    Ancestors(termId: string): TermInfo[];
}
