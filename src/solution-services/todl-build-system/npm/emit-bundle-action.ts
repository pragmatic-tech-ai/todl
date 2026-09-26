import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { ProjectType } from "../../package-manager/manifest.js";
import { type PackageBundle, type PublishedClass, ProducerResources } from "../../project-services/core/package-bundle.js";
import { projectAnnotations } from "../../../publish/reflect.js";
import { PACKAGE_NODE_ID } from "../../../compiler-services/model/kinds.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Emits `bundle.json` — the load-bearing index Plexus's meta-model browser reads to
// discover and mount a published package (it keys on `.type`) — into the sandbox, plus
// the producer-resource scan (palette classes' template/thumbnail/doc, plus the
// asset/doc/sample listings) that bundle.json carries. Ports the bundle-building block
// from the deprecated `ProducerProjectFactory.publish()` (producer-project-factory-base.ts)
// into the build-action pipeline, so the npm-package flavor's output is complete without
// going through that legacy path.
//
// Only a producer (meta-model or library) publishes a bundle — an architecture carries a
// graph fragment, not an instantiable palette, so it has none. Gated on the project type
// via `DiscriminatorFor`; anything else (or a missing CompiledModel artifact, meaning the
// compile gate upstream did not produce a model) is a clean no-op — no write, no throw.
export class EmitBundleAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-bundle";
    private static readonly BundleFileName = "bundle.json";
    private static readonly MetaModelType = "meta-model";
    private static readonly LibraryType = "library";

    public readonly Name = EmitBundleAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const type = EmitBundleAction.DiscriminatorFor(ctx.Manifest.type);
        if (type === undefined) return; // architecture etc. — no palette to bundle

        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined) return; // the compile gate did not produce a model

        const manifest = ctx.Manifest;
        const metaModels = manifest.metaModels ?? [];
        const libraries = manifest.libraries ?? [];

        const classes: PublishedClass[] = pkg.classes.map((c) => ({ ...c }));
        const scanned = await ProducerResources.Scan(ctx.Project, classes.map((c) => c.id));
        for (const c of classes)
        {
            const r = scanned.byClass.get(c.id);
            if (r?.template !== undefined) c.template = r.template;
            if (r?.thumbnail !== undefined) c.thumbnail = r.thumbnail;
            if (r?.doc !== undefined) c.doc = r.doc;
        }

        const bundle: PackageBundle = {
            type,
            id: pkg.id, version: pkg.version, name: pkg.name ?? pkg.id,
            metaModels, libraries,
            classes, assets: scanned.assets, docs: scanned.docs, samples: scanned.samples,
            annotations: projectAnnotations(pkg.document, PACKAGE_NODE_ID),
        };

        await ctx.Sandbox.WriteText(EmitBundleAction.BundleFileName, JSON.stringify(bundle, null, 2));
    }

    // The producer discriminator bundle.json carries under `.type` — Plexus's meta-model
    // browser keys on this exact string. `undefined` for any non-producer project type
    // (architecture), which the caller treats as "no bundle to emit".
    private static DiscriminatorFor(type: ProjectType): string | undefined
    {
        switch (type)
        {
            case ProjectType.MetaModel:
                return EmitBundleAction.MetaModelType;
            case ProjectType.Library:
                return EmitBundleAction.LibraryType;
            default:
                return undefined;
        }
    }
}
