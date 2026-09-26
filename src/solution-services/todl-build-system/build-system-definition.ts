import type { ServiceToken } from "@pragmatic-tech-ai/todl-runtime";
import type { IBuildSystem } from "../build-system-core/build-system.js";
import type { TodlBuildContext } from "./todl-build-context.js";
import type { ProjectManifest } from "../package-manager/manifest.js";

export interface BuildSystemDefinition
{
    readonly Id: string;
    readonly System: ServiceToken<IBuildSystem<TodlBuildContext, ProjectManifest>>;
}
