import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProject } from "../project.js";

const dec = new TextDecoder();

/** A minimal valid project.plexus manifest (library kind), as JSON. */
const MANIFEST = JSON.stringify({ type: "library", name: "todl-demo", version: 1, id: "demo", libVersion: "0.1.0" }, null, 2);

test("readProject collects .todl as sources and every other file as a resource", () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-proj-"));
  writeFileSync(join(dir, "project.plexus"), MANIFEST);
  writeFileSync(join(dir, "demo.todl"), "concept EC2;\n");
  writeFileSync(join(dir, "theme.mu"), "resources DemoTheme {}\n");
  mkdirSync(join(dir, "img"), { recursive: true });
  writeFileSync(join(dir, "img", "logo.svg"), "<svg/>");
  // Build/dep dirs are skipped entirely.
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "x", "index.js"), "module.exports = {}");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "model.json"), "{}");

  const project = readProject(dir);

  assert.deepEqual(project.sources.map((s) => s.uri), ["demo.todl"]);
  const resources = project.resources.map((r) => ({ path: r.path, text: dec.decode(r.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(resources, [
    { path: "img/logo.svg", text: "<svg/>" },
    { path: "project.plexus", text: MANIFEST },
    { path: "theme.mu", text: "resources DemoTheme {}\n" },
  ]);
});
