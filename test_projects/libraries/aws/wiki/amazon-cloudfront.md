# Amazon CloudFront

## Purpose

AWS global content delivery network. Caches and serves data, video, applications, and APIs from edge locations close to users, integrated with Shield, S3, ELB, EC2, and Lambda@Edge for origin-side compute.

## Trade-offs

- Cache invalidation is eventual (minutes, not seconds) and metered
  past 1,000 paths/month. Cache-bust-on-deploy patterns either need
  versioned URLs or an invalidation budget the team actually tracks.
- Edge compute splits awkwardly: Lambda@Edge runs full Node/Python
  but pays cold-start cost; CloudFront Functions is sub-millisecond
  but pure JS with 2 KB request limits and no network access. Most
  serious manipulation falls into the gap between them.
- vs. Cloudflare / Fastly: CloudFront wins when origins are S3, ALB,
  or API Gateway — ACM, Shield, and OAC make the AWS-native path
  effortless. For multi-cloud origins, edge-config flexibility, or
  Workers-class compute, the alternatives lead.
