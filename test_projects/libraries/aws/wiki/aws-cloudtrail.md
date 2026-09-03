# AWS CloudTrail

## Purpose

Audit-log feed of AWS API calls. Records caller identity, time, source IP, request parameters, and response elements for security and compliance investigations.

## Trade-offs

- Management events are essentially free; Data Events
  (S3 GetObject, Lambda Invoke, DynamoDB item access) cost
  per million events and explode the bill if turned on
  broadly. Enable Data Events selectively for high-risk
  buckets, not everywhere.
- 90 days of history in the console is a CloudTrail Lake
  feature, not a default. Default trails write to S3 and the
  team needs Athena or CloudTrail Lake to query history. Plan
  the analytics layer alongside the trail.
- Audit gap awareness: not every AWS service emits every action
  to CloudTrail. Data-plane operations on some services are
  invisible. Compliance audits that assume "CloudTrail = full
  history" surface this gap painfully.
