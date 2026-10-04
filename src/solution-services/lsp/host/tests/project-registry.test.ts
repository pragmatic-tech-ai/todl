import { test } from "node:test";
import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PushedSourceProvider, ProjectRegistry, type OpenDocuments } from "../project-registry.js";

// An OpenDocuments stub exposing just `all()` (the only method providers use) — it
// implements the narrowed surface directly, so no cast is needed.
class DocsStub
{
    public static With(...docs: TextDocument[]): OpenDocuments
    {
        return { all: () => docs };
    }
}

test("assigns a document to its project by longest-prefix match", () =>
{
    const reg = new ProjectRegistry();
    reg.Register("todl://p1/");
    reg.Register("todl://p1/nested/");   // longer prefix wins
    assert.equal(reg.ProjectFor("todl://p1/a.todl")?.RootUri, "todl://p1/");
    assert.equal(reg.ProjectFor("todl://p1/nested/b.todl")?.RootUri, "todl://p1/nested/");
    assert.equal(reg.ProjectFor("todl://other/x.todl"), null);
});

test("SetBases registers the root and stores bases; MarkDirty flags it", () =>
{
    const reg = new ProjectRegistry();
    reg.SetBases("todl://p/", []);
    const p = reg.ProjectFor("todl://p/x.todl")!;
    assert.deepEqual(p.Bases, []);
    assert.equal(p.Dirty, true);   // SetBases marks dirty
    assert.equal(p.Snapshot, null);
    p.Dirty = false;
    reg.MarkDirty("todl://p/");
    assert.equal(reg.DirtyProjects().length, 1);
});

test("Register is idempotent; All and Remove manage the set", () =>
{
    const reg = new ProjectRegistry();
    const a = reg.Register("todl://p/");
    assert.equal(reg.Register("todl://p/"), a);
    assert.equal(reg.All().length, 1);
    reg.Remove("todl://p/");
    assert.equal(reg.All().length, 0);
});

test("pushed provider returns the open documents under the project root", () =>
{
    const reg = new ProjectRegistry();
    const p = reg.Register("todl://p/");
    const docs = DocsStub.With(
        TextDocument.create("todl://p/a.todl", "todl", 1, "namespace demo { }"),
        TextDocument.create("todl://other/b.todl", "todl", 1, "namespace x { }"),
    );
    const provider = new PushedSourceProvider();
    assert.deepEqual(provider.InitialRoots(), []);
    const sources = provider.SourcesFor(p, docs);
    assert.deepEqual(sources.map((s) => s.uri), ["todl://p/a.todl"]);
    assert.equal(sources[0]!.text, "namespace demo { }");
});
