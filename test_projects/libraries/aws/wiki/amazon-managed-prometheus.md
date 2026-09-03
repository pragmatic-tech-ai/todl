# Amazon Managed Service for Prometheus

## Purpose

Serverless Prometheus-compatible metrics backend. Auto-scales ingestion, storage, and querying; replicated across three AZs for HA.

## Trade-offs

- Per-sample ingestion + per-GB storage + per-query pricing.
  High-cardinality metric labels (the Prometheus performance
  trap) translate directly to high bills here. Cardinality
  governance is even more important than on self-hosted
  Prometheus.
- Rules and recording rules execute server-side and are billed.
  Heavy rule sets that aggregate millions of series add real
  cost; review and prune unused rules periodically.
- vs. self-managed Prometheus + Thanos / Grafana Cloud
  Prometheus: AMP wins on AWS-native auth and no Thanos
  operations. Self-hosted with Thanos remains cheaper at high
  steady scale; Grafana Cloud leads on unified observability
  pricing.
