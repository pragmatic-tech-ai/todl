# Amazon Elastic Container Registry

## Purpose

Managed Docker/OCI container registry. Integrated with ECS, EKS, and Fargate; IAM-based resource-level access control.

## Trade-offs

- Storage costs accumulate silently. Image layers persist by
  digest; without lifecycle policies, registries grow without
  bound — especially CI/CD repositories that produce per-commit
  images. ECR's per-GB charges are modest individually but
  large at fleet scale.
- Cross-region replication is configured, not implicit. Multi-
  region production setups need replication rules set up
  explicitly; the registry itself is region-bound.
- vs. Docker Hub / GitHub Container Registry / GCR: ECR wins on
  IAM-native auth, no rate-limit pain, and VPC endpoint support.
  Docker Hub is the discovery surface for upstream images;
  serious production workloads pull through ECR mirrors to
  escape Docker Hub's rate limits.
