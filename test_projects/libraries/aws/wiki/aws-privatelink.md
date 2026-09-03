# AWS PrivateLink

## Purpose

Private endpoint service for AWS APIs and VPC-hosted applications. Keeps east-west traffic on the AWS network, eliminating internet egress for sensitive integrations.

## Trade-offs

- Interface-endpoint cost multiplies: hourly per-endpoint fee +
  per-GB processed + ENI footprint, per AZ, per VPC, per consumed
  service. Many-VPC architectures with many AWS-service endpoints
  produce a large fixed-cost floor that a transit-VPC or
  endpoint-sharing pattern can collapse.
- Use gateway endpoints (S3, DynamoDB) when available — they are
  free, route-table-based, and do not consume ENIs. Reaching for
  PrivateLink instead is the most common waste pattern.
- Resolves region-locally only. Cross-region private access needs
  VPC peering or Transit Gateway between regions plus an endpoint
  in each, which is materially more setup than the marketing
  diagram suggests.
