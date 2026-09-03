# Amazon Relational Database Service

## Purpose

Managed relational databases across six engines: MySQL, MariaDB, PostgreSQL, Oracle, SQL Server, and an RDS-on-Outposts variant. Handles patching, backups, replicas, and failover.

## Trade-offs

- Engine licensing dominates economics for commercial engines.
  RDS for Oracle BYOL vs. license-included, RDS for SQL Server
  edition selection — these decisions can outweigh instance
  sizing. Engineering teams often over-spec instances to mask
  poor licensing choices.
- vs. Aurora: Aurora has the better storage layer and more
  reliable failover; RDS-vanilla MySQL/Postgres is meaningfully
  cheaper for write-light workloads and remains portable.
  "Use Aurora by default" is good advice; "Aurora for everything"
  overspends.
- Major-version upgrades are still disruptive. RDS automates the
  binary work but the team owns SQL-level regression testing,
  pg_dump compatibility checks, and downtime planning. The
  "managed" label doesn't change that responsibility.
