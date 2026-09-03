# AWS Fault Injection Service

## Purpose

Managed chaos-engineering platform. Pre-built templates inject controlled failures — instance termination, throttling, latency — to validate workload resilience.

## Trade-offs

- Useful exactly when the team has the operational discipline
  to act on chaos-experiment findings. Without a follow-up loop
  (post-experiment review, fix-issues-found, re-run), FIS
  produces theatrical breakage with no learning.
- Fault catalogue is AWS-centric. Application-layer faults
  (specific HTTP error injection, dependency-circuit-breaker
  testing) are limited compared to Gremlin or LitmusChaos.
  FIS covers infrastructure-layer chaos well.
- vs. Gremlin / LitmusChaos / Chaos Mesh: specialised chaos
  vendors lead on application-layer faults, business-context
  experiments, and game-day workflows. FIS wins on AWS-native
  IAM, no-agent-needed simplicity, and integration with the
  AWS resources you want to break.
