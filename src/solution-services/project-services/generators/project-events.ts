/**
 * The project lifecycle event bus: the event shape a host (or a project factory)
 * raises, and the minimal sink interface a raiser depends on. The concrete
 * `ProjectEvents` bus is what composition wires the `GeneratorScheduler` onto as
 * a subscriber.
 */

import { ServiceKey, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { type ProjectManifest } from "../../package-manager/manifest.js";

/** The lifecycle moments a project can raise an event for. */
export enum ProjectEventKind
{
    Created,
    Opened,
    ReferencesChanged,
    Saved,
}

export interface ProjectEvent
{
    readonly Kind: ProjectEventKind;
    readonly ProjectType: string;
    readonly Project: IStorage;
    readonly Manifest: ProjectManifest;
}

// The sink the host (and factory) call to announce a lifecycle event. Kept minimal
// so a factory depends only on raising, not on subscription.
export interface IProjectEvents
{
    Raise(event: ProjectEvent): Promise<void>;
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

    public Subscribe(handler: ProjectEventHandler): void
    {
        this.handlers.push(handler);
    }

    public async Raise(event: ProjectEvent): Promise<void>
    {
        for (const handler of this.handlers)
        {
            await handler(event);
        }
    }
}
