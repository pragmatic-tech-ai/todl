# Savings Plans

## Purpose

Flexible commitment-based discount programme. Three flavours — Compute, EC2 Instance, and SageMaker AI — over 1- or 3-year terms in exchange for hourly-spend commitments.

## Trade-offs

- Term-based commit. 1- and 3-year terms with no-upfront /
  partial / all-upfront payment options. Wrong-sized SP =
  unutilised commit (waste) or insufficient coverage (paying
  on-demand). Right-sizing requires Cost Explorer forecasting,
  not gut feel.
- Compute SP is most flexible (any region, any instance family);
  EC2 Instance SP discounts more but locks to one family/region;
  SageMaker SP applies only to SageMaker. Picking by max
  flexibility (Compute) is the safe default; picking by max
  discount (EC2 Instance) requires confidence in the workload.
- vs. Reserved Instances: SPs largely replaced RIs for EC2/
  Fargate/Lambda; RIs still exist for RDS, ElastiCache,
  Redshift, OpenSearch. The two-product overlap creates
  decision-tree confusion that's worth the FinOps team
  flattening for the rest of the org.
