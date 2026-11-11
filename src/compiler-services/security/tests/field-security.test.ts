import { test } from "node:test";
import assert from "node:assert/strict";

import { check, checkAgainst } from "../../api.js";
import { Builder } from "../../model/builder.js";
import { MetaKind } from "../../model/kinds.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../../diagnostics/diagnostic.js";
import type { SourceFile } from "../../diagnostics/span.js";
import type { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../../emit/json.js";
import { compilePackage, type CompileOutcome } from "../../../publish/publish.js";

/** The field-security fixture: own `hr.Employee` with two secured fields, plus a compiled `crm` dependency. */
class FieldFx
{
    public static readonly HrUri = "hr.todl";
    public static readonly BodyUri = "body.todl";
    public static readonly Hr = `namespace hr
{
    concept Employee : todl.system.Owned { Name : string; secured Salary : number?; secured NationalId : string?; Band : string?; }
}`;
    private static base: TodlDocument | undefined;

    /** The compiled `crm` dependency: `Account` with a secured `Revenue`. */
    public static Base(): TodlDocument
    {
        FieldFx.base ??= toJSON(check([{ uri: "crm.todl", text: "namespace crm { concept Account { name : string; secured Revenue : number?; } }" }]).model);
        return FieldFx.base;
    }

    /** Publish the own `hr` package with `body` added. */
    public static Compile(body = ""): CompileOutcome
    {
        return compilePackage([FieldFx.Base()], FieldFx.Sources(body), { id: "hr", version: "1.0.0" });
    }

    /** Compile `body` inside `namespace hr { import crm; … }` against the base. */
    public static Check(body: string): { model: Repository; diagnostics: Diagnostic[] }
    {
        return checkAgainst([FieldFx.Base()], FieldFx.Sources(body));
    }

    public static Errors(diagnostics: readonly Diagnostic[]): Diagnostic[]
    {
        return diagnostics.filter((d) => d.severity === Severity.Error);
    }

    /** Assert the only error is one `code` with a span. */
    public static Rejects(body: string, code: DiagnosticCode): void
    {
        const errors = FieldFx.Errors(FieldFx.Check(body).diagnostics);
        assert.deepEqual(errors.map((d) => d.code), [code], JSON.stringify(errors));
        assert.ok(errors[0]!.span, `${code} has a span`);
    }

    private static Sources(body: string): SourceFile[]
    {
        return [
            { uri: FieldFx.HrUri, text: FieldFx.Hr },
            { uri: FieldFx.BodyUri, text: `namespace hr\n{\n    import crm;\n    ${body}\n}` },
        ];
    }
}

test("secured flag survives compile and JSON round-trip", () =>
{
    const out = FieldFx.Compile();
    assert.ok(out.ok, JSON.stringify(out.errors));
    const doc = out.package!.document;
    const employee = doc.nodes.find((n) => n.id === "hr.Employee")!;
    assert.equal(employee.fields.find((f) => f.name === "Salary")!.secured, true);
    assert.equal(employee.fields.find((f) => f.name === "Name")!.secured, undefined);
});

test("profile lowers to one field-profile node", () =>
{
    const { model, diagnostics } = FieldFx.Check(`profile Compensation { Employee.Salary : read, update; }`);
    assert.deepEqual(FieldFx.Errors(diagnostics), []);
    const node = model.resolve("hr.Compensation@profile")!;
    assert.equal(node.metaKind, MetaKind.FieldProfile);
    assert.equal(node.attrs.get(Builder.ProfileNameAttr), "Compensation");
    assert.deepEqual(JSON.parse(String(node.attrs.get(Builder.ProfileFieldsAttr))),
        [{ Concept: "hr.Employee", Field: "Salary", Read: true, Update: true, Create: false }]);
});

test("security rejections", () =>
{
    const cases: readonly [string, DiagnosticCode][] = [
        // secured in an aspect body
        [`aspect Banded { secured Band2 : string?; }`, DiagnosticCode.SecuritySecuredOnAspect],
        // identity Employee key NationalId
        [`identity Employee key NationalId;`, DiagnosticCode.SecuritySecuredIdentityKey],
        // match over a secured field
        [`match Employee { same when a.NationalId == b.NationalId; }`, DiagnosticCode.SecuritySecuredMatchMember],
        // derive over a secured member
        [`aspect Banded { Band2 : string?; } concept Graded : Banded { secured Salary : string?; derive Band2 = Salary; }`, DiagnosticCode.SecuritySecuredInDerive],
        // profile on unsecured Name
        [`profile P { Employee.Name : read; }`, DiagnosticCode.SecurityProfileFieldNotSecured],
        // profile on a missing field
        [`profile P { Employee.Missing : read; }`, DiagnosticCode.SecurityProfileUnknownField],
        // profile right 'write'
        [`profile P { Employee.Salary : read, write; }`, DiagnosticCode.SecurityUnknownProfileRight],
        // profile on a dependency concept's field
        [`profile P { Account.Revenue : read; }`, DiagnosticCode.SecurityForeignConcept],
        // two profiles named Compensation
        [`profile Compensation { Employee.Salary : read; } profile Compensation { Employee.NationalId : read; }`, DiagnosticCode.SecurityDuplicateProfile],
    ];
    for (const [body, code] of cases)
    {
        FieldFx.Rejects(body, code);
    }
});

test("profile Employee.Salary : update; is security.write-without-read", () =>   // PR8
{
    const { diagnostics } = FieldFx.Check(`profile Payroll { Employee.Salary : update; }`);
    assert.deepEqual(FieldFx.Errors(diagnostics).map((d) => d.code), [DiagnosticCode.SecurityWriteWithoutRead]);
    assert.ok(FieldFx.Errors(diagnostics)[0]!.span);
});

test("profile Employee.Salary : create; is security.write-without-read", () =>
{
    FieldFx.Rejects(`profile Payroll { Employee.Salary : create; }`, DiagnosticCode.SecurityWriteWithoutRead);
});

test("profile Employee.Salary : read, create; is accepted", () =>
{
    const { model, diagnostics } = FieldFx.Check(`profile Payroll { Employee.Salary : read, create; }`);
    assert.deepEqual(FieldFx.Errors(diagnostics), []);
    assert.deepEqual(JSON.parse(String(model.resolve("hr.Payroll@profile")!.attrs.get(Builder.ProfileFieldsAttr))),
        [{ Concept: "hr.Employee", Field: "Salary", Read: true, Update: false, Create: true }]);
});
