# AWS Elastic Disaster Recovery

## Purpose

DR service replicating on-premises and cloud workloads into AWS with point-in-time recovery and minimal recovery cost. For AWS China or replication into Outposts, the legacy CloudEndure DR product is still required.

## Trade-offs

- Continuous block-level replication makes RPO seconds and
  RTO minutes — better than snapshot-based DR — but at meaningful
  per-source-host monthly cost plus storage. Budget for both.
- DR is exactly as good as its testing cadence. Drift between
  source and DR environment (security groups, IAM, application
  config, AD trusts) is the failure mode that bites — Elastic
  Disaster Recovery automates replication, not configuration
  parity.
- vs. Zerto / Veeam Cloud Connect / native cross-region
  replication: third-party DR vendors lead on cross-cloud
  failover scenarios; AWS-native snapshot replication is
  cheaper when seconds-of-RPO isn't required.
