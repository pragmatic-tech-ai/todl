/**
 * The headless (NODE-ONLY) entry point for the project system (CLI, devUI main, smoke
 * tests): seeds the identical registries as `TodlNodeProjectSystemModule` — the
 * browser-safe core PLUS the html-bundle build system — but with no mural
 * `app.Modules` block — just a bare `CompositionRoot`. It superseded the retired
 * `GeneratorRegistryContribution`: the one-call path for a host that wants everything
 * `ProjectSystemComposer` seeds, including the lifecycle scheduler wiring.
 */

import { type CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { type IContributionSource } from "../../../application/contribution-source.js";
import { type ProjectSystemComposerOptions } from "./project-system-composer.js";
import { NodeProjectSystemComposer } from "./node-project-system-composer.js";
import { type IPackageSource } from "../../todl-build-system/package-source.js";

export class ProjectSystemContribution implements IContributionSource
{
    public constructor(private readonly source?: IPackageSource)
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        NodeProjectSystemComposer.Compose(root.Provider, this.Options());
    }

    // `exactOptionalPropertyTypes` forbids `{ Source: undefined }` for an optional
    // field — omit the key entirely when no source was supplied, rather than
    // writing `undefined` into it.
    private Options(): ProjectSystemComposerOptions
    {
        return this.source === undefined ? {} : { Source: this.source };
    }
}
