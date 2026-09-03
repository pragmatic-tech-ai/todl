# AWS IoT Analytics

## Purpose

Managed analytics service for IoT data at scale. Filters, transforms, and enriches IoT data, then stores it in a time-series store for SQL queries and ML inference.

## Trade-offs

- Deprecated. AWS announced the end of IoT Analytics for new
  customers; existing workloads need a migration path. The
  forward path is Kinesis Data Firehose → S3 + Athena/Glue, or
  Timestream for time-series-shaped analysis.
- Was always a wrapper around Kinesis + Glue + Athena with an
  IoT-flavoured UX. Going direct to the primitives is more
  flexible and usually cheaper.
- Catalogue entry retained for legacy reference only.
