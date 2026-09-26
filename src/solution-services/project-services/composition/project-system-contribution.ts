/**
 * The headless entry point for the project system (CLI, devUI main, smoke tests):
 * seeds the identical registries as `TodlProjectSystemModule` but with no mural
 * `app.Modules` block — just a bare `CompositionRoot`. Additive alongside
 * `GeneratorRegistryContribution` (see `ProjectSystemComposer`'s header); this is
 * the new one-call path for a host that wants everything `ProjectSystemComposer`
 * seeds, not just the generator registry.
 */

import { type CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { type IContributionSource } from "../../../application/contribution-source.js";
import { ProjectSystemComposer, type ProjectSystemComposerOptions } from "./project-system-composer.js";
import { type IPackageSource } from "../../todl-build-system/package-source.js";

export class ProjectSystemContribution implements IContributionSource
{
    public constructor(private readonly source?: IPackageSource)
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        ProjectSystemComposer.Compose(root.Provider, this.Options());
    }

    // `exactOptionalPropertyTypes` forbids `{ Source: undefined }` for an optional
    // field — omit the key entirely when no source was supplied, rather than
    // writing `undefined` into it.
    private Options(): ProjectSystemComposerOptions
    {
        return this.source === undefined ? {} : { Source: this.source };
    }
}
