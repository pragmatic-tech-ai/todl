# AWS Budgets

## Purpose

Cost and usage budget alerting. Targets EC2, RDS, Redshift, and ElastiCache reservation utilisation in addition to general spend thresholds.

## Trade-offs

- Per-budget fee after free tier. Many granular budgets per
  cost-centre adds up. Most estates land on a smaller number
  of carefully-scoped budgets.
- Reactive — Budgets alerts after the spend happens. For real-
  time cost control, Budgets Actions can stop instances or
  revoke IAM, but those are blunt instruments rarely safe in
  production.
- vs. Cost Anomaly Detection (now in Cost Explorer) + manual
  review: Anomaly Detection catches unusual spend patterns;
  Budgets enforces planned thresholds. Use both rather than
  choosing.
