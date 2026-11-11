import { test } from "node:test";
import assert from "node:assert/strict";
import { SecurityAction, SecurityDepth, BaseRoleName, SecurityTerms } from "../security-terms.js";

test("action values are the C1 PrivilegeAction strings", () =>
    assert.deepEqual(Object.values(SecurityAction), ["create", "read", "update", "delete", "append", "appendTo", "assign", "share", "invoke"]));
test("depth values are the C1 AccessLevel strings", () =>
    assert.deepEqual(Object.values(SecurityDepth), ["none", "user", "businessUnit", "businessUnitAndChildren", "organization"]));
test("base role values are the C4 names", () => assert.deepEqual(Object.values(BaseRoleName), ["SystemAdministrator", "BasicUser", "Reader"]));
test("BaseRoleOf is exact", () => { assert.equal(SecurityTerms.BaseRoleOf("BasicUser"), BaseRoleName.BasicUser); assert.equal(SecurityTerms.BaseRoleOf("basicuser"), undefined); });
