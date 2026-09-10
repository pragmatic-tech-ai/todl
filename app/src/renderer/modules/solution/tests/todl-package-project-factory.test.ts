import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { TodlPackageProjectFactory, TodlPackageProject, TODL_PACKAGE_TYPE } from "../todl-package-project-factory.js";

test("createProject writes a project.plexus manifest and returns a project", async () => {
    const storage = new FakeStorage();
    const factory = new TodlPackageProjectFactory();
    const project = await factory.createProject(storage, "My Package");
    assert.ok(project instanceof TodlPackageProject);
    assert.equal((project as TodlPackageProject).Name, "My Package");
    const manifest = JSON.parse(await storage.ReadText("project.plexus"));
    assert.equal(manifest.type, TODL_PACKAGE_TYPE);
    assert.equal(manifest.name, "My Package");
});

test("openProject reads the name back from the manifest", async () => {
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: TODL_PACKAGE_TYPE, name: "Reopened", version: 1 }));
    const project = await new TodlPackageProjectFactory().openProject(storage);
    assert.equal((project as TodlPackageProject).Name, "Reopened");
});

test("saveProject round-trips through storage", async () => {
    const storage = new FakeStorage();
    const factory = new TodlPackageProjectFactory();
    const project = await factory.createProject(storage, "Round");
    await factory.saveProject(project, storage);
    const reopened = await factory.openProject(storage);
    assert.equal((reopened as TodlPackageProject).Name, "Round");
});
