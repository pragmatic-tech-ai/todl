# Amazon RDS for Db2

## Purpose

Managed Db2 with Multi-AZ high availability and cross-Region backups. Aimed at IBM Db2 customers seeking AWS-managed lifecycle without the heavy DBA overhead.

## Trade-offs

- BYOL only. IBM Db2 license must be brought via Passport
  Advantage or IBM Cloud; AWS doesn't sell included licensing.
  License compliance reviews are on the customer.
- Audience is narrow: existing Db2 estates that want managed
  ops without leaving the engine. Greenfield work almost always
  picks Postgres or Aurora over Db2; the choice rarely exists
  outside of a modernisation-in-place scenario.
- vs. IBM Cloud Db2-as-a-Service: IBM Cloud has tighter feature
  parity with on-prem Db2 (federation, advanced replication).
  RDS for Db2 wins when "stay on AWS, single cloud" is the
  hard constraint despite a feature gap.
