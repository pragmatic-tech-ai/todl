# Amazon RDS on VMware

## Purpose

Deploys managed RDS-style relational databases inside on-premises VMware environments. Replicates to AWS-resident RDS instances for hybrid topologies.

## Trade-offs

- Effectively deprecated. AWS has scaled back RDS-on-VMware
  investment in favour of running RDS on Outposts or migrating
  workloads to AWS-resident RDS. Greenfield deployments should
  not target it.
- Hybrid-DB-as-a-Service was always a niche posture. The
  control-plane complexity (cross-environment failover, network
  partition tolerance, license portability) rarely paid for
  itself outside specific data-residency cases.
- Migration target depends on intent: data-residency requirement
  → RDS on Outposts or AWS Local Zones; just wanting on-prem
  managed Postgres → a third-party DBaaS like EDB or Crunchy
  Bridge.
