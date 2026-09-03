# Amazon Redshift

## Purpose

Petabyte-scale columnar data warehouse for standard SQL analytics. Runs complex queries across structured and semi-structured data with familiar BI-tool connectivity.

## Trade-offs

- Provisioned RA3 nodes pay for storage and compute even when
  the warehouse is idle. WLM tuning, vacuum/analyse hygiene, and
  distribution-key choice remain ongoing operations work — the
  "managed" wrapper does not absorb them.
- Concurrency scaling and short-query acceleration help with
  bursts but are cost-multipliers in disguise. A poorly-modelled
  workload that triggers concurrency scaling constantly can
  double the bill before the team notices.
- vs. Snowflake / BigQuery: Redshift wins on AWS-native integration
  (S3, Glue, Lake Formation, IAM) and predictable cost at steady
  state. Snowflake leads on multi-cluster compute isolation and
  cross-cloud reach; BigQuery on per-query simplicity. Pick by
  ecosystem alignment, not by raw benchmark.
