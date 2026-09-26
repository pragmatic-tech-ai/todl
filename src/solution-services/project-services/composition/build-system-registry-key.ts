import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { BuildSystemRegistry } from "../../build-system-core/build-system-registry.js";
import type { TodlBuildContext } from "../../todl-build-system/todl-build-context.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";

// The container key `ProjectSystemComposer` registers the bare `BuildSystemRegistry`
// under. `todl-build-system-module.mu` keys its own `TodlBuildSystemRegistry` by class
// token (see todl-build-system/todl-build-system-registry.ts) — that composition unit
// is untouched; this key belongs to the NEW composer, which seeds a plain
// `BuildSystemRegistry<TodlBuildContext, ProjectManifest>` instance instead.
export const BuildSystemRegistryKey =
    new ServiceKey<BuildSystemRegistry<TodlBuildContext, ProjectManifest>>("BuildSystemRegistry");
