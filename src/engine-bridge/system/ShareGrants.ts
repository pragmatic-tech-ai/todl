import { createHash } from 'node:crypto';
import type { CellValue } from '@pragmatic-tech-ai/graph';
import { ShareRight, type ShareSubject, SystemNames } from './SystemNames.js';

/** How a share grant node is identified and what it stores (ruling T10). */
export class ShareGrants
{
    private static readonly IdPrefix = 'share.';
    private static readonly HashAlgorithm = 'sha256';
    private static readonly HexEncoding = 'hex';
    private static readonly Separator = '\u0000';
    private static readonly HashLength = 32;
    private static readonly Rights: readonly ShareRight[] = [ShareRight.Read, ShareRight.Update, ShareRight.Delete, ShareRight.Assign, ShareRight.Share];

    /**
     * The grant's engine public id: `share.` and the first 32 hex digits of sha256(record NUL kind NUL subject). It is
     * deterministic, so sharing a record with a subject again addresses (updates) the same grant.
     */
    public static PublicId(recordId: string, kind: ShareSubject, subjectId: string): string
    {
        const key = [recordId, kind, subjectId].join(ShareGrants.Separator);
        const hex = createHash(ShareGrants.HashAlgorithm).update(key).digest(ShareGrants.HexEncoding);
        return ShareGrants.IdPrefix + hex.slice(0, ShareGrants.HashLength);
    }

    /** The grant's property values: the subject, then every right (true when listed, false otherwise). */
    public static Properties(kind: ShareSubject, subjectId: string, rights: readonly ShareRight[]): ReadonlyMap<string, CellValue>
    {
        const granted = new Set(rights);
        const values = new Map<string, CellValue>([
            [SystemNames.SubjectKind, kind],
            [SystemNames.SubjectId, subjectId],
        ]);
        for (const right of ShareGrants.Rights)
        {
            values.set(right, granted.has(right));
        }
        return values;
    }
}
