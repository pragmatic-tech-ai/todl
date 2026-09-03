# Amazon Security Lake

## Purpose

Purpose-built data lake centralising security telemetry from AWS, SaaS, on-premises, and cloud sources in the Open Cybersecurity Schema Framework format.

## Trade-offs

- OCSF normalisation is the value proposition. Without
  downstream consumers (Athena queries, Splunk via subscriber,
  custom analytics), Security Lake is just an expensive log
  bucket. Plan the consumer side before turning it on.
- Multi-source ingestion has uneven quality. AWS-native sources
  are clean; SaaS subscriber-format sources vary in coverage
  and depth. The unified schema fights the realities of how
  different vendors emit data.
- vs. Splunk / Sumo Logic / building a custom S3-based SIEM:
  Security Lake is the storage primitive, not a SIEM. Pair it
  with Athena + dashboards for cost-conscious teams, or feed
  a SIEM as the analytics layer. Standalone, it doesn't replace
  either.
