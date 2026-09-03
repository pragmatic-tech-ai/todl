# AWS Fargate

## Purpose

Serverless container runtime for ECS and EKS. Specify CPU, memory, networking, and IAM; AWS provisions the underlying capacity without you managing clusters of VMs.

## Trade-offs

- Per-vCPU-second and per-GB-second pricing carries a real
  premium over equivalent EC2. For steady workloads, EC2-backed
  ECS/EKS with reservations costs significantly less; the
  break-even is around 70-80% utilisation.
- Constrained capabilities. No DaemonSet, no host-mount, no GPU
  (in most regions), task ephemeral storage capped. Workloads
  that need any of those land back on EC2-backed launch types.
- vs. EC2 launch type: Fargate wins on operations simplicity
  and bin-packing-free architecture. EC2 wins on cost at scale,
  GPU support, and flexibility. Mixed clusters (Fargate for
  bursty, EC2 for baseline) are a common production answer.
