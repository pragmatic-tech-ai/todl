import { test } from "node:test";
import assert from "node:assert/strict";

import { PackageSecurity } from "../package-security.js";
import { compilePackage, type CompileOutcome } from "../../../publish/publish.js";

/** The package-security fixture: the `projects` package, its edge-concept variants, and the `hr` / `hr-ext` pair. */
class SecFx
{
    public static readonly Projects = `namespace projects
{
    concept Person { name : string; }
    concept Project : todl.system.Owned { name : string; secured budget : number?; }
    concept Task : todl.system.Owned { title : string; }
    role ProjectMember { Task { read = user; } Project { read = user; } }
    role ProjectManager { Project { update = businessUnit; read = businessUnitAndChildren; } }
    contribute BasicUser { Project { read = user; } }
    contribute BasicUser { Task { read = user; } }
    profile Finance { Project.budget : read, update; }
}`;
    public static readonly ProjectsWithAssignment = `namespace projects
{
    concept Person { name : string; }
    concept Project : todl.system.Owned { name : string; }
    concept Assignment { from : Person; to : Project; role : string?; }
    operator ==> : Assignment (from, to);
}`;
    public static readonly NonReified = "namespace projects { concept Node { relates : Node?; } operator ~> : Node.relates; }";
    public static readonly Hr = "namespace hr { concept Employee : todl.system.Owned { name : string; } }";
    public static readonly HrExt = "namespace hrext { import hr; concept Contractor : hr.Employee { agency : string?; } }";

    public static Compile(text: string, id = "projects"): CompileOutcome
    {
        const out = compilePackage([], [{ uri: "p.todl", text }], { id, version: "1.0.0" });
        assert.ok(out.ok, JSON.stringify(out.errors));
        return out;
    }
}

test("projects compiles to qualified roles, contributions, secured fields and profiles", () =>
{
    const out = SecFx.Compile(SecFx.Projects);
    const s = out.package!.Security;
    assert.deepEqual(s.OwnedConcepts, ["projects.Project", "projects.Task"]);
    assert.deepEqual(s.Roles.map((r) => r.Name), ["projects.ProjectManager", "projects.ProjectMember"]);
    assert.deepEqual(s.BaseRoleContributions.map((r) => r.Name), ["BasicUser"]);
    assert.equal(s.BaseRoleContributions[0]!.Privileges.length, 2);
    assert.deepEqual(s.SecuredFields, [{ Concept: "projects.Project", Field: "budget" }]);
    assert.deepEqual(s.FieldProfiles[0], { Name: "projects.Finance", Fields: [{ Concept: "projects.Project", Field: "budget", Read: true, Update: true, Create: false }] });
    assert.deepEqual(out.package!.document.security, s);
});

test("a package without security has PackageSecurity.Empty and no document.security", () =>
{
    const out = SecFx.Compile("namespace plain { concept Thing { name : string; } }", "plain");
    assert.equal(out.package!.Security, PackageSecurity.Empty);
    assert.equal(out.package!.document.security, undefined);
});

test("a dependent package's subconcept of an owned concept is in its OwnedConcepts", () =>
{
    const base = SecFx.Compile(SecFx.Hr, "hr").package!;
    const out = compilePackage([base.fullDocument], [{ uri: "x.todl", text: SecFx.HrExt }], { id: "hr-ext", version: "1.0.0" });
    assert.ok(out.ok, JSON.stringify(out.errors));
    assert.deepEqual(out.package!.Security.OwnedConcepts, ["hrext.Contractor"]);
});

test("reified edge concepts are listed with their endpoint members", () =>
{
    const s = SecFx.Compile(SecFx.ProjectsWithAssignment).package!.Security;
    assert.deepEqual(s.EdgeConcepts, [{ Concept: "projects.Assignment", From: "from", To: "to" }]);
    assert.ok(!s.OwnedConcepts.includes("projects.Assignment"));
});

test("a non-reified operator lists no edge concept", () =>
{
    assert.deepEqual(SecFx.Compile(SecFx.NonReified).package!.Security.EdgeConcepts, []);
});
