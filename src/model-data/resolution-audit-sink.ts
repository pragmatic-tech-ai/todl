import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { MergeDecision } from "../compiler-services/resolution/resolution-pass.js";

/** One audit event per connector Prepare that folded at least one merge: the merge decisions for a model's
 *  resolved document. Carries source/member/model names and node ids only — never connection settings or
 *  secret values. */
export interface ResolutionAuditEvent
{
    readonly model: string;
    readonly decisions: readonly MergeDecision[];
}

/** Host-provided audit seam the engine emits merge decisions to during a connector Prepare. Declared engine-side
 *  and free of any upper-layer type, so the engine resolves and emits without depending on the host. */
export interface IResolutionAuditSink
{
    Record(event: ResolutionAuditEvent): Promise<void>;
}

export const ResolutionAuditSinkKey = new ServiceKey<IResolutionAuditSink>("ResolutionAuditSink");
