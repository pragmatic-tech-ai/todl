# Amazon Aurora

## Purpose

MySQL- and PostgreSQL-compatible relational engine with a distributed, fault-tolerant, self-healing storage layer that auto-scales up to 128 TB per instance.

## Trade-offs

- AWS-only. The storage layer that makes Aurora special doesn't
  port. Migrating off Aurora to RDS-vanilla or another cloud's
  managed Postgres/MySQL is a real undertaking — schema and SQL
  port cleanly, performance characteristics and recovery
  behaviour do not.
- Cost vs. vanilla RDS is meaningful. Aurora's per-IOPS pricing
  (or Aurora I/O-Optimized's flat pricing) makes write-heavy
  workloads significantly more expensive than RDS-MySQL/Postgres
  on EBS gp3. Model the I/O profile, not just instance hours.
- Serverless v2 changed the economics for spiky workloads but
  still has a non-trivial floor (0.5 ACU minimum). Genuinely
  bursty workloads benefit; stable production workloads usually
  cost less on provisioned Aurora with reservations.
