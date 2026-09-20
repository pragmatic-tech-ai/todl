// A mural file that instantiates the PackagesTestCompositionRoot and composes the
// PackageServicesEngine module onto it — the markup form of building the package
// engine composition for a test host.
import PackagesTestCompositionRoot from "./packages-test-composition-root.js"
import PackageServicesEngine from "../packages-services-engine.mu.js"

PackagesTestCompositionRoot {
    .modules: {
        PackageServicesEngine
    }
}
