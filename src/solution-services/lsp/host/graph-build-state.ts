// The engine-owned lifecycle of the shared solution graph's FULL build (the warmup and
// each solution switch): Building while a full assembly is in flight, then Ready on
// success or Failed when the build was rejected (duplicate member id, dependency cycle).
// Incremental live-edit replaces do not move it.
export enum GraphBuildState
{
    Building = "building",
    Ready = "ready",
    Failed = "failed",
}
