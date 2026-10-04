import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectEvents, ProjectEventKind, type ProjectEvent } from "../project-events.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";

// Fixtures as static members on a class — no free functions.
class Fixtures
{
    private static readonly ProjectId = "p";

    public static Event(): ProjectEvent
    {
        const manifest: ProjectManifest = { type: ProjectType.MetaModel, name: Fixtures.ProjectId, version: 1, id: Fixtures.ProjectId, packageVersion: "1.0.0" };
        return {
            Kind: ProjectEventKind.ReferencesChanged,
            ProjectType: manifest.type,
            Project: new FakeStorage(),
            Manifest: manifest,
        };
    }
}

test("a handler that unsubscribes during Raise does not skip the following handler", async () =>
{
    const bus = new ProjectEvents();
    const seen: string[] = [];

    // The first handler unsubscribes itself mid-raise (splicing the live array); the
    // second handler must still run — iterating a snapshot guarantees it.
    const first = bus.Subscribe(async () =>
    {
        seen.push("first");
        first.dispose();
    });
    bus.Subscribe(async () =>
    {
        seen.push("second");
    });

    await bus.Raise(Fixtures.Event());

    assert.deepEqual(seen, ["first", "second"]);
    assert.equal(bus.SubscriberCount, 1);   // only the first detached
});

test("a handler that unsubscribes a sibling during Raise still runs every handler scheduled for this raise", async () =>
{
    const bus = new ProjectEvents();
    const seen: string[] = [];

    const second = bus.Subscribe(async () =>
    {
        seen.push("second");
    });
    bus.Subscribe(async () =>
    {
        seen.push("first");
        second.dispose();   // remove the already-iterated sibling
    });
    bus.Subscribe(async () =>
    {
        seen.push("third");
    });

    await bus.Raise(Fixtures.Event());

    assert.deepEqual(seen, ["second", "first", "third"]);
});
