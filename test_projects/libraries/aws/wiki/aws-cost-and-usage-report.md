# AWS Cost and Usage Report

## Purpose

Comprehensive cost-and-usage data feed at hourly or daily granularity, with cost-allocation tags. The canonical source for custom FinOps dashboards.

## Trade-offs

- Free to enable but the volume is non-trivial. Hourly-granular
  CUR for a large organisation lands as many GB per day in
  S3; the storage and downstream-query cost adds up.
- Schema changes over time. AWS adds columns; consumers
  (CloudHealth, Cloudability, custom Athena dashboards) must
  re-validate after AWS schema updates. CUR 2.0 vs. legacy
  CUR are different file layouts.
- vs. Cost Explorer API: CUR is the raw data; Cost Explorer is
  the curated console. FinOps automations use CUR; humans use
  Cost Explorer. Mature estates have both.
