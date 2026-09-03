# Amazon Lightsail managed databases

## Purpose

Managed MySQL and PostgreSQL databases bundled with Lightsail. Standard or high-availability configurations at a fixed monthly price for hobbyist and small-business workloads.

## Trade-offs

- Lightsail is intentionally limited. Capacity tiers cap out
  fast; production workloads that grow run into the ceiling and
  end up migrating to RDS — a migration that's avoidable by
  starting on RDS.
- Flat monthly pricing is appealing for forecasting but punishes
  underutilisation. Many Lightsail DBs run at <20% load while
  the customer pays for the full tier; a t4g.micro RDS often
  costs less for the same workload.
- Use Lightsail DBs for genuine hobby / SMB workloads where
  operational simplicity matters more than scaling headroom.
  Everything else belongs on RDS or Aurora.
