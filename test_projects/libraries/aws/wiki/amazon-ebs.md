# Amazon Elastic Block Store

## Purpose

Persistent block storage volumes for EC2 instances. Each volume is replicated within its Availability Zone for high availability and consistent low-latency performance.

## Trade-offs

- AZ-local. Volumes don't fail over across AZs — a Multi-AZ
  architecture needs replication at the application layer
  (database replicas, cluster filesystems) or use of EFS / S3.
  "Replicated within its AZ" is not the same as "highly available".
- Volume-type choice has price/perf cliffs. gp3 is the modern
  default; io2/io2 Block Express buys reserved IOPS at high cost;
  st1/sc1 are throughput-optimised and unsuitable for random
  I/O. Wrong-fit volumes either underperform or overspend by
  large factors.
- Snapshot lifecycle is on you. EBS snapshots accumulate in S3
  with per-snapshot cost; without lifecycle policies (DLM or
  AWS Backup) they grow without bound. Forgotten snapshots are
  the most common AWS hidden-cost finding.
