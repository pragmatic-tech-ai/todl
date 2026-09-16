import type { PackageSource, PackageRef, ResolvedPackage } from "@pragmatic-tech-ai/todl/domain";
import type { RegistryClient } from "../../services/registry/registry-client.js";

// The renderer-side Domain backend: every resolve/versions call is served by the
// main process over the registry IPC (local store first, network fallback). This
// is what SolutionManagerService.Compose loads members through.
export class IpcPackageSource implements PackageSource {
  constructor(private readonly client: RegistryClient) {}

  resolve(ref: PackageRef): Promise<ResolvedPackage> {
    return this.client.resolvePackage(ref);
  }

  versions(model: string): Promise<readonly string[]> {
    return this.client.packageVersions(model);
  }
}
