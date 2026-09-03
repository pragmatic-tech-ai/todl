# AWS App Mesh

## Purpose

Service mesh for microservices on AWS. Uses the open-source Envoy proxy to standardise service-to-service communication, observability, and traffic shaping across ECS, EKS, EC2, and Fargate workloads.

## Trade-offs

- Effectively in maintenance: AWS has signalled VPC Lattice as the
  forward path for managed service-to-service and Istio-on-EKS for
  the BYO-Envoy path. Greenfield service-mesh work should not start
  here.
- Sidecar tax is real: every pod or ECS task gets an Envoy proxy,
  typically costing 50-200m CPU and 64-256 MiB of memory on top of
  the workload. At fleet scale this is a measurable line item.
- vs. Istio: similar control-plane shape but smaller feature set —
  no ambient mode, fewer EnvoyFilter knobs, no built-in
  multi-cluster federation. Compensating with custom tooling
  largely erases the "managed" benefit App Mesh originally sold.
