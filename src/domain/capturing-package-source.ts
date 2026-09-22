import { Domain, type PackageSource, type PackageRef, type ResolvedPackage } from "./domain.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";

// A decorator PackageSource that records each resolved package's own-only document,
// keyed by identity. This is the seam that lets a DomainHost collect documents even
// though the Domain performs the internal resolve + deps-first walk.
export class CapturingPackageSource implements PackageSource
{
    private readonly documents = new Map<string, TodlDocument>();

    constructor(private readonly inner: PackageSource) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        const resolved = await this.inner.resolve(ref);
        if (resolved.document !== undefined) this.documents.set(Domain.identity(resolved.ref), resolved.document);
        return resolved;
    }

    public versions(model: string): Promise<readonly string[]>
    {
        if (this.inner.versions === undefined) return Promise.resolve([]);
        return this.inner.versions(model);
    }

    public DocumentFor(identity: string): TodlDocument | undefined
    {
        return this.documents.get(identity);
    }
}
