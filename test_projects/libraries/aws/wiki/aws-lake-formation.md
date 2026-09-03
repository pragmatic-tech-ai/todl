# AWS Lake Formation

## Purpose

Lakehouse provisioning and governance layer on top of S3 and Glue. Catalogues data, classifies sensitivity with ML, and enforces fine-grained access policies for analytics consumers.

## Trade-offs

- Permission model is intricate. Lake Formation grants overlay
  IAM and Glue Catalog permissions; "effective access" depends on
  the intersection of three systems. Debugging "why can't I query
  this table" is a recurring task that requires walking all
  three layers.
- Adoption is most painful at the boundary. Tables not yet
  registered with Lake Formation behave under IAM rules; tables
  registered behave under Lake Formation rules. Mixed estates
  during a migration are a steady source of authorisation
  surprises.
- vs. Apache Ranger / Privacera: Lake Formation is AWS-deep but
  AWS-only. Multi-engine, multi-cloud governance estates often
  pair Lake Formation with a vendor that covers Snowflake,
  Databricks, on-prem Hadoop, and BI tools.
