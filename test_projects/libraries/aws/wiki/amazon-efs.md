# Amazon Elastic File System

## Purpose

Elastic Linux file system for AWS and hybrid workloads. Scales on demand to petabytes; storage classes include Standard, IA, and Archive for cost-tiered retention.

## Trade-offs

- Per-GB pricing is high vs. EBS. EFS Standard is ~3x gp3 pricing
  per GB; the multi-AZ availability and shared-filesystem
  semantics are paid for. Workloads that don't need shared
  multi-attach belong on EBS.
- Throughput modes are easy to misconfigure. Bursting mode runs
  out of burst credits on sustained workloads; Elastic and
  Provisioned avoid that but cost meaningfully more. Most
  surprise EFS bills come from provisioned-throughput
  miscalculations.
- vs. FSx for Lustre / FSx for OpenZFS: EFS is the AWS-native
  Linux file system option with broad compatibility. FSx
  variants win on raw throughput (Lustre), advanced features
  (snapshots, compression on OpenZFS), or Windows protocol
  support. Pick by access pattern and protocol need.
