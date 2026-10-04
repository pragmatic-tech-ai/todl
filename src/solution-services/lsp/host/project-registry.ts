import type { TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SourceFile } from "../../../compiler-services/diagnostics/span.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { AnalysisSnapshot } from "../analysis/analysis-snapshot.js";

export interface Project
{
    RootUri: string;
    Bases: TodlDocument[];
    Snapshot: AnalysisSnapshot | null;
    Dirty: boolean;
}

// Holds every open project and assigns documents to them by longest-prefix match
// on the project root URI, so one server partitions cleanly.
export class ProjectRegistry
{
    private readonly projects = new Map<string, Project>();

    public Register(rootUri: string): Project
    {
        let p = this.projects.get(rootUri);
        if (p === undefined)
        {
            p = { RootUri: rootUri, Bases: [], Snapshot: null, Dirty: true };
            this.projects.set(rootUri, p);
        }
        return p;
    }

    public SetBases(rootUri: string, bases: TodlDocument[]): void
    {
        const p = this.Register(rootUri);
        p.Bases = bases;
        p.Dirty = true;
    }

    public ProjectFor(uri: string): Project | null
    {
        let best: Project | null = null;
        for (const p of this.projects.values())
        {
            if (uri.startsWith(p.RootUri) && (best === null || p.RootUri.length > best.RootUri.length)) best = p;
        }
        return best;
    }

    public MarkDirty(rootUri: string): void
    {
        const p = this.projects.get(rootUri);
        if (p !== undefined) p.Dirty = true;
    }

    public DirtyProjects(): Project[] { return [...this.projects.values()].filter((p) => p.Dirty); }
    public All(): Project[] { return [...this.projects.values()]; }
    public Remove(rootUri: string): void { this.projects.delete(rootUri); }
}

export interface SourceProvider
{
    // The project roots known at startup (pushed: []).
    InitialRoots(folders: string[]): string[];
    // The SourceFile set to analyze for a project.
    SourcesFor(project: Project, openDocs: TextDocuments<TextDocument>): SourceFile[];
}

// Pushed mode: sources are the live text of open documents under the project root.
export class PushedSourceProvider implements SourceProvider
{
    public InitialRoots(): string[] { return []; }

    public SourcesFor(project: Project, openDocs: TextDocuments<TextDocument>): SourceFile[]
    {
        return openDocs.all()
            .filter((d) => d.uri.startsWith(project.RootUri))
            .map((d) => ({ uri: d.uri, text: d.getText() }));
    }
}
