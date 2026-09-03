# AWS Database Migration Service

## Purpose

Schema and data migration between database engines. Supports homogeneous (same-engine) and heterogeneous migrations plus continuous replication; DMS Serverless removes capacity-planning.

## Trade-offs

- Homogeneous migrations work well. Heterogeneous (Oracle→
  Postgres, SQL Server→Aurora) is much harder than the
  marketing implies — Schema Conversion Tool (SCT) handles
  syntax, but stored procs, triggers, and application SQL
  often need manual rewriting.
- CDC (change data capture) is useful but fragile. Source-side
  binlog/CDC configuration, replication-instance sizing, and
  long-running task health are constant operational concerns.
- vs. Striim / Qlik Replicate / Fivetran: specialist data-
  replication vendors lead on real-time CDC with rich
  transformations. DMS wins on cost for one-time migrations
  and on tight integration with AWS target databases.
