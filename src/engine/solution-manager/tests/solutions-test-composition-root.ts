import { CompositionRoot } from '@pragmatic-tech-ai/todl-runtime';
import { SolutionManagerService } from '../engine/solution-manager-service.js';

// A CompositionRoot for solution-engine tests. The SolutionServicesEngine module
// is composed onto it from markup — see solutions-test-composition-root.mu, which
// instantiates this root and lists the module in a `.modules:` block — so a test
// resolves SolutionManagerService (and the settings / factory registries the
// module brings) exactly the way a shell or CLI would, no hand-rolled provider.
// No host kind is set, so the root admits the (universal) engine module.
//
// The host SEAMS the engine resolves — the storage-provider registry, prompt
// service and package source (and the optional notification service) — are NOT
// baked in: a test registers them on `Provider` before resolving `Manager`, which
// is safe because every module registration is a lazy factory.
export class SolutionsTestCompositionRoot extends CompositionRoot
{
    // The composed manager (built lazily from the module's registration on first
    // access, once the host seams are registered on Provider).
    public get Manager(): SolutionManagerService
    {
        return this.Provider.getRequired(SolutionManagerService.Key);
    }
}
