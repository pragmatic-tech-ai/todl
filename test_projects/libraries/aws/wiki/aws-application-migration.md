# AWS Application Migration Service

## Purpose

Lift-and-shift migration for source servers running on physical, virtual, or other-cloud infrastructure into AWS-native EC2 instances with minimal downtime.

## Trade-offs

- Continuous block-level replication enables short-cutover
  migrations — that's the point. The setup, network bandwidth
  to AWS, and source-server agents are real engineering work,
  not zero-touch.
- Lift-and-shift is the easy migration but rarely the best
  end state. MGN gets workloads to AWS; the modernisation
  (refactor to managed services, containerise, re-architect)
  is the project after MGN finishes.
- vs. CloudEndure (now MGN itself) / Carbonite Migrate / Zerto:
  third-party migration tools lead on cross-cloud and on-prem
  to multi-cloud scenarios. MGN wins when AWS is the target
  and tight Migration-Hub integration matters.
