// Public surface of the Domain module (SPEC-06).
export {
    Domain,
    Heap,
    type PackageRef,
    type DomainToken,
    type DomainEdge,
    type SeedGraph,
    type ResolvedPackage,
    type PackageSource,
    type ResolveRequest,
} from "./domain.js";
export { DomainHost, DomainHostBase, type IDomainHost } from "./domain-host.js";
export { CompositePackageSource } from "./composite-package-source.js";
export { MemoryPackageSource } from "./memory-package-source.js";
export { CapturingPackageSource } from "./capturing-package-source.js";
