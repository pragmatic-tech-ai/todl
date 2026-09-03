# AWS Data Exchange

## Purpose

Marketplace for third-party datasets. Subscribers consume data directly from S3 and analyse it with AWS analytics and ML services without bespoke ingest pipelines.

## Trade-offs

- Dataset quality and refresh cadence are vendor-dependent.
  AWS provides the distribution channel, not the QA — listings
  vary widely in completeness, freshness, and schema stability.
  Production dependencies need direct contracts with the data
  provider, not just a subscription.
- Pricing is vendor-set and frequently opaque. Headline subscription
  prices on the catalogue don't always reflect the production
  contract terms; expect to negotiate for serious use.
- vs. Snowflake Marketplace / Datarade: Data Exchange wins when
  consuming data needs to flow straight into S3/Athena/Redshift
  with AWS-native delivery. For Snowflake-resident workloads or
  cross-cloud consumers, the AWS-specific delivery format is a
  minor friction.
