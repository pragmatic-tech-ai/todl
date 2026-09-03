# Amazon Lookout for Metrics

## Purpose

Anomaly detection over business and operational metrics (sales dips, acquisition shifts). Support discontinued by AWS on 10 October 2025; included here for legacy reference.

## Trade-offs

- Support ended 10 October 2025. Workloads still using it are
  on borrowed time — migration is not optional, it's overdue.
  Catalogue entry is retained for legacy-architecture reference,
  not for new selection.
- Migration target depends on the metrics' shape: business KPIs
  with seasonality → QuickSight ML insights or a Prophet-on-
  SageMaker job; ops metrics → DevOps Guru or CloudWatch
  anomaly detection; high-cardinality time series → a SageMaker
  custom pipeline.
- Anything still pointing at this service should treat it as a
  hard-deprecated dependency, not a working service with a
  better alternative.
