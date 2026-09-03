# Amazon Elastic Container Service

## Purpose

AWS-native container orchestrator. Launches and scales Docker workloads through API calls without operating your own Kubernetes or Swarm control plane.

## Trade-offs

- AWS-only. ECS task definitions, service constructs, and
  scheduler don't port. Multi-cloud aspirations push teams to
  Kubernetes despite the operational tax — once on ECS, leaving
  is a re-platform.
- Simpler than EKS by design — fewer features, fewer knobs, fewer
  failure modes. The trade-off is a smaller ecosystem: ECS lacks
  Kubernetes's rich operator and Helm-chart catalogues.
  Re-implementing common patterns (autoscaling on custom metrics,
  cron schedules, GitOps) takes more bespoke work.
- vs. EKS / App Runner / Fargate: ECS wins when "containerised
  workloads on AWS without K8s expertise" is the priority and
  the team plans to stay on AWS. EKS wins on portability and
  ecosystem; App Runner on stateless web simplicity. The choice
  is a long-term commitment, not a config flag.
