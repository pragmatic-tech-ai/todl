# Amazon Elastic Kubernetes Service

## Purpose

Managed certified-conformant Kubernetes control plane across multiple Availability Zones. Existing tooling and Helm charts work unchanged.

## Trade-offs

- The control plane is managed; the cluster is not. Node groups,
  AWS Load Balancer Controller, Cluster Autoscaler / Karpenter,
  CSI drivers, networking (VPC CNI vs. Cilium), and upgrade
  cadence remain on the team. "Managed Kubernetes" is a smaller
  feature than the marketing suggests.
- Per-cluster $0.10/hour control-plane fee plus node costs plus
  data-transfer. EKS makes economic sense when the team needs
  Kubernetes; for "just want to run containers", ECS or App
  Runner avoid the cluster overhead entirely.
- vs. ECS / GKE / AKS / on-prem K8s: EKS is the portable option
  for AWS-resident workloads that want K8s ecosystem leverage.
  GKE leads on Kubernetes capabilities (Autopilot, native
  features); AKS on Microsoft-stack integration. Pick by where
  the team needs to be in 3 years, not 6 months.
