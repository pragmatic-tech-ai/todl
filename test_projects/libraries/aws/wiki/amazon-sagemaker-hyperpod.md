# Amazon SageMaker AI HyperPod

## Purpose

Pre-configured ML training cluster for foundation-model scale. Comes with distributed training libraries and self-healing clusters that detect, repair, or replace faulty instances automatically.

## Trade-offs

- Real audience is foundation-model trainers. HyperPod's value
  (self-healing clusters, lifecycle scripts, persistent storage)
  pays back at the scale of multi-node multi-week training jobs.
  Below that scale, SageMaker Training jobs are simpler and
  cheaper.
- Capacity is gated and expensive. GPU instance availability
  (P5, P4d, Trn1) and the per-hour cost mean HyperPod commitments
  are six-to-seven-figure decisions, not a service to "try out".
- vs. Slurm on EC2 / Kubernetes + Volcano / dedicated AI clouds
  (CoreWeave, Lambda Labs): HyperPod removes some operational
  toil but does not match raw price/perf of dedicated AI clouds
  for top-tier GPU access. Pick by capacity availability and
  ecosystem fit, not branding.
