# Amazon Athena

## Purpose

Serverless SQL query service over data in S3. Charges only for queries run; integrates with the AWS Glue Data Catalog for unified metadata across analytics services.

## Trade-offs

- Pay-per-TB-scanned demands disciplined data layout. Without
  columnar storage (Parquet/ORC), partitioning, and partition
  projection, exploratory queries on a 100 TB table can cost more
  than a month of a Redshift cluster.
- Concurrency caps surface as workgroup quotas, not slow queries.
  High-concurrency BI dashboards either lift quotas through
  Support or get re-pointed at Redshift Spectrum or cached
  result sets — Athena is not designed as a dashboard backend.
- vs. Redshift / Snowflake: Athena wins on cheap sporadic analyst
  use over data already in S3. For repeated high-frequency BI
  workloads, a fixed-cost warehouse with materialised views and
  result caching has both better latency and more predictable
  spend.
