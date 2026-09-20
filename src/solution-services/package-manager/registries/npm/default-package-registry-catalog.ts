import { type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { PackageRegistryCatalog } from '../../engine/package-registry-catalog.js'
import { NpmPackageRegistryFactory } from './npm-package-registry-factory.js'
import { NpmConnectionFactory } from './npm-connection-factory.js'

// The engine's built-in registry catalog: it establishes the one registry type todl
// ships — npm — from the two npm factories resolved from the container by their
// static Keys, so any host that composes the package engine gets the npm type with
// no app-side wiring. A host that ships a different type set shadows the catalog key
// with its own IPackageRegistryCatalog.
//
// A provider-taking subclass of the generic PackageRegistryCatalog so the
// `.services:` `Impl -> Token` markup can register it as `(p) => new Impl(p)`; the
// base stays list-based (a test composes any factory set) and still enforces the
// registration-order rule.
export class DefaultPackageRegistryCatalog extends PackageRegistryCatalog
{
    constructor(provider: IServiceProvider)
    {
        super(
            [provider.getRequired(NpmPackageRegistryFactory.Key)],
            [provider.getRequired(NpmConnectionFactory.Key)],
        )
    }
}
