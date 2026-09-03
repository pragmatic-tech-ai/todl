# AWS Compute Optimizer

## Purpose

ML-driven right-sizing recommendations for EC2, EBS, and Lambda. Analyses historical utilisation and recommends configuration changes to cut cost or boost performance.

## Trade-offs

- Recommendations are advice, not actions. Compute Optimizer
  finds the candidates; right-sizing them requires application-
  level testing, change windows, and rollback plans. Most teams
  enable it eagerly, act on suggestions slowly.
- Needs 14 days of CloudWatch data to make useful suggestions.
  New workloads or recently-resized instances show as
  "Optimisation impact: unavailable" for two weeks.
- vs. Densify / CloudHealth / Spot.io Eco / third-party FinOps
  tools: dedicated FinOps platforms lead on multi-cloud
  recommendations, RI/SP optimisation, and chargeback. Compute
  Optimizer is free and AWS-only; for serious cost work it
  pairs with a FinOps platform rather than replacing one.
