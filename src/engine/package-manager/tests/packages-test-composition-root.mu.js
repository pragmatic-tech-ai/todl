import { PackageServicesEngine } from "../packages-services-engine.mu.js";
import { PackagesTestCompositionRoot } from "./packages-test-composition-root.js";

export function create() {
    const _packagesTestCompositionRoot0 = new PackagesTestCompositionRoot();
    _packagesTestCompositionRoot0.AddModule(PackageServicesEngine);
    return _packagesTestCompositionRoot0;
}
