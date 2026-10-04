/**
 * The project lifecycle event bus: the event shape a host (or a project factory)
 * raises, and the minimal sink interface a raiser depends on. The concrete
 * `ProjectEvents` bus is what composition wires the `GeneratorScheduler` onto as
 * a subscriber.
 */

import { ServiceKey, Disposable, type IStorage, type IDisposable } from "@pragmatic-tech-ai/todl-runtime";
import { type ProjectManifest } from "../../package-manager/manifest.js";

/** The lifecycle moments a project can raise an event for. */
export enum ProjectEventKind
{
    Created,
    Opened,
    ReferencesChanged,
    Saved,
    MemberRemoved,
}

export interface ProjectEvent
{
    readonly Kind: ProjectEventKind;
    readonly ProjectType: string;
    readonly Project: IStorage;
    readonly Manifest: ProjectManifest;
}

// The lifecycle-event contract: raise an event, and subscribe to events. Subscribe
// returns an IDisposable whose dispose() detaches the handler — so a subscriber can
// actually unsubscribe (true teardown, no leaked handler), not merely go inert.
export interface IProjectEvents
{
    Raise(event: ProjectEvent): Promise<void>;
    Subscribe(handler: ProjectEventHandler): IDisposable;
}

// Service token so a project factory can OPTIONALLY resolve the events sink and raise
// Created at project creation (Task 7). Absent from a container ⇒ no events raised.
export const ProjectEventsKey = new ServiceKey<IProjectEvents>("ProjectEvents");

// The concrete in-memory bus: subscribers are notified in registration order; Raise
// awaits each. Composition wires the GeneratorScheduler as a subscriber.
export type ProjectEventHandler = (event: ProjectEvent) => Promise<void>;

export class ProjectEvents implements IProjectEvents
{
    private readonly handlers: ProjectEventHandler[] = [];

    // Attach a handler; the returned IDisposable detaches it. Backward-compatible —
    // a caller that ignores the return value stays subscribed for the bus's lifetime.
    public Subscribe(handler: ProjectEventHandler): IDisposable
    {
        this.handlers.push(handler);
        return new Disposable(() => this.Unsubscribe(handler));
    }

    // The number of currently-attached handlers — a leak-assertion seam for tests.
    public get SubscriberCount(): number
    {
        return this.handlers.length;
    }

    public async Raise(event: ProjectEvent): Promise<void>
    {
        for (const handler of this.handlers)
        {
            await handler(event);
        }
    }

    private Unsubscribe(handler: ProjectEventHandler): void
    {
        const index = this.handlers.indexOf(handler);
        if (index !== -1) this.handlers.splice(index, 1);
    }
}
