import { CompositionRoot } from '@pragmatic-tech-ai/todl-runtime'
import { PackageManagerService } from '../engine/package-manager-service.js'

// A CompositionRoot for package-engine tests. PackageServicesEngine is composed onto
// it from markup — see packages-test-composition-root.mu, which instantiates this
// root and lists the module in a `.modules:` block — so a test resolves
// PackageManagerService (and the npm factories + catalog the module brings) exactly
// the way a shell or CLI would, with no hand-rolled provider. No host kind is set,
// so the root admits the (universal) engine module.
//
// The host SEAMS the engine resolves — the connection store, the secret store, the
// storage provider (and the optional HTTP transport) — are NOT baked in: a test
// registers them on `Provider` before resolving `Manager`, which is safe because
// every module registration is a lazy factory.
export class PackagesTestCompositionRoot extends CompositionRoot
{
    public get Manager(): PackageManagerService
    {
        return this.Provider.getRequired(PackageManagerService.Key)
    }
}
