/**
 * The NODE-ONLY extension of `ProjectSystemComposer`: composes the browser-safe core
 * (factories, generators, baker, npm-package build system, lifecycle) and then layers
 * on the html-bundle build system, whose `BundleAppAction` needs esbuild + node fs.
 * One seeding implementation — this class only ADDS to what the core seeded, it never
 * re-seeds. Exported solely from the node-only `./project-system` subpath.
 */

import { type IServiceContainer } from "@pragmatic-tech-ai/todl-runtime";
import { HtmlBundleBuildSystem } from "../../todl-build-system/html-bundle/html-bundle-build-system.js";
import { EsbuildBundler } from "../../todl-build-system/html-bundle/node/esbuild-bundler.js";
import { BundlerKey } from "../../build-system-core/bundler.js";
import { ProjectSystemComposer, type ProjectSystemComposerOptions } from "./project-system-composer.js";

export class NodeProjectSystemComposer extends ProjectSystemComposer
{
    public static override Compose(container: IServiceContainer, options: ProjectSystemComposerOptions = {}): void
    {
        super.Compose(container, options);

        container.registerInstance(BundlerKey, new EsbuildBundler());
        HtmlBundleBuildSystem.Register(container);
    }
}
