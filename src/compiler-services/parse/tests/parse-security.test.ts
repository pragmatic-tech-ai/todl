import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type ConceptDecl, type ContributionDecl, type ProfileDecl, type RoleDecl } from "../ast.js";

class SecurityParseHarness
{
  public static Decls(text: string)
  {
    const { namespace, diagnostics } = parse(text, "t.todl");
    assert.deepEqual(diagnostics, [], "no parse diagnostics");
    return namespace.declarations;
  }
}

test("role, contribute, profile and secured parse", () =>
{
  const decls = SecurityParseHarness.Decls(`namespace projects
{
    concept Project : todl.system.Owned { name : string; secured budget : number?; }
    role ProjectManager
    {
        Project { read = businessUnitAndChildren; update = businessUnit; }
    }
    contribute BasicUser
    {
        Project { read = user; }
    }
    profile Finance
    {
        Project.budget : read, update;
    }
}`);
  const role = decls.find((d) => d.kind === DeclKind.Role) as RoleDecl;
  assert.equal(role.name, "ProjectManager");
  assert.equal(role.concepts[0]!.concept, "Project");
  assert.deepEqual(role.concepts[0]!.entries.map((e) => ({ action: e.action, depth: e.depth })),
    [{ action: "read", depth: "businessUnitAndChildren" }, { action: "update", depth: "businessUnit" }]);
  assert.equal((decls.find((d) => d.kind === DeclKind.Contribution) as ContributionDecl).baseRole, "BasicUser");
  const profile = decls.find((d) => d.kind === DeclKind.Profile) as ProfileDecl;
  assert.deepEqual({ concept: profile.entries[0]!.concept, field: profile.entries[0]!.field, rights: profile.entries[0]!.rights },
    { concept: "Project", field: "budget", rights: ["read", "update"] });
  const concept = decls.find((d) => d.kind === DeclKind.Concept) as ConceptDecl;
  assert.equal(concept.fields.find((f) => f.name === "budget")!.secured, true);
});

test("a field named secured still parses", () =>
{
  const concept = SecurityParseHarness.Decls(`namespace t { concept C { secured : string; } }`)[0] as ConceptDecl;
  assert.equal(concept.fields[0]!.name, "secured");
  assert.ok(!concept.fields[0]!.secured);
});

test("qualified concept in a role", () =>
{
  const role = SecurityParseHarness.Decls(`namespace t { role R { acme.core.Thing { read = organization; } } }`)[0] as RoleDecl;
  assert.equal(role.concepts[0]!.concept, "acme.core.Thing");
});

test("profile entry spans separate concept and field", () =>
{
  const profile = SecurityParseHarness.Decls(`namespace t { profile P { acme.Thing.cost : read; } }`)[0] as ProfileDecl;
  const entry = profile.entries[0]!;
  assert.equal(entry.concept, "acme.Thing");
  const text = "namespace t { profile P { acme.Thing.cost : read; } }";
  const conceptStart = text.indexOf("acme") + 1;
  assert.equal(entry.conceptSpan!.start.column, conceptStart);
  assert.equal(entry.conceptSpan!.end.column, conceptStart + "acme.Thing".length);
  assert.equal(entry.fieldSpan!.start.column, conceptStart + "acme.Thing.".length);
  assert.equal(entry.fieldSpan!.end.column, conceptStart + "acme.Thing.cost".length);
});

test("secured on a non-field member is a diagnostic spanned on the keyword", () =>
{
  const text = `namespace t { concept C { secured note = "x"; } }`;
  const { diagnostics } = parse(text, "t.todl");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.span!.start.column, text.indexOf("secured") + 1);
});
