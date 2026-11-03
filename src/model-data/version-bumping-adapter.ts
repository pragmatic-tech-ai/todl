import { WriteConcurrency, WriteOperationKind } from "./connector-plan.js";
import type { ExternalFieldValue, ExternalRecord, QueryRequest, WriteBatch, WriteOperation, WriteResult } from "./connector-plan.js";
import type { ConnectionFailureKind } from "./connection-reconnect.js";
import type { IDataSourceAdapter, PageQuery, PageSlice } from "./data-source-adapter.js";

/**
 * Server-side version bumping for optimistic writes. An Optimistic upsert whose fields leave the version column absent
 * (or equal to the expected version) and whose expected version is a finite number is written with version + 1, so a
 * client never has to compute the next version and a second writer holding the old version conflicts. A caller that
 * sets a different version keeps it; a non-numeric version, and every version of a source that assigns its own
 * (IDataSourceAdapter.SourceManagesVersions: HTTP etags, a GraphQL version argument), is never touched. The version
 * each applied upsert now carries is reported in WriteResult.Versions so callers can keep their copy current.
 */
export class VersionBumpingAdapter implements IDataSourceAdapter
{
    // Optional capabilities are present exactly when the wrapped adapter has them (absent stays absent).
    public readonly ClassifyFailure?: (error: unknown) => ConnectionFailureKind;
    public readonly QueryPage?: (request: QueryRequest, page: PageQuery) => Promise<PageSlice>;

    constructor(private readonly inner: IDataSourceAdapter)
    {
        if (inner.ClassifyFailure !== undefined) this.ClassifyFailure = (error) => inner.ClassifyFailure!(error);
        if (inner.QueryPage !== undefined) this.QueryPage = (request, page) => inner.QueryPage!(request, page);
    }

    /** The batch as it will be written: each bumpable optimistic upsert carries its next version. */
    public static Bumped(batch: WriteBatch): WriteBatch
    {
        const field = batch.VersionField;
        if (batch.Concurrency !== WriteConcurrency.Optimistic || field === undefined) return batch;
        return { ...batch, Operations: batch.Operations.map((op) => VersionBumpingAdapter.BumpedOp(op, field)) };
    }

    private static BumpedOp(op: WriteOperation, field: string): WriteOperation
    {
        if (op.Kind !== WriteOperationKind.Upsert || typeof op.Version !== "number" || !Number.isFinite(op.Version)) return op;
        const supplied = Object.hasOwn(op.Fields, field) ? op.Fields[field] : undefined;
        if (supplied !== undefined && supplied !== op.Version) return op;
        return { ...op, Fields: { ...op.Fields, [field]: op.Version + 1 } };
    }

    public get CanTransact(): boolean
    {
        return this.inner.CanTransact === true;
    }

    public get CanVersion(): boolean
    {
        return this.inner.CanVersion === true;
    }

    public get CanPage(): boolean
    {
        return this.inner.CanPage === true;
    }

    public Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return this.inner.Query(request);
    }

    public get SourceManagesVersions(): boolean
    {
        return this.inner.SourceManagesVersions === true;
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        // A source that assigns its own versions (etag / server-side) is never second-guessed.
        if (this.inner.SourceManagesVersions === true) return this.inner.Apply(batch);
        const bumped = VersionBumpingAdapter.Bumped(batch);
        const result = await this.inner.Apply(bumped);
        if (bumped === batch || result.Applied === 0) return result;
        const failed = new Set(result.Failures.map((f) => String(f.Key)));
        const versions: { Key: ExternalFieldValue; Version: ExternalFieldValue }[] = [];
        bumped.Operations.forEach((op, i) =>
        {
            // Only ops this wrapper actually bumped are reported (a caller-set or non-numeric version is not ours to report).
            if (op === batch.Operations[i] || failed.has(String(op.Key))) return;
            versions.push({ Key: op.Key, Version: op.Fields[batch.VersionField!]! });
        });
        return versions.length === 0 ? result : { ...result, Versions: versions };
    }

    public Dispose(): Promise<void>
    {
        return this.inner.Dispose();
    }
}
