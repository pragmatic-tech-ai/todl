# AWS CodePipeline

## Purpose

Managed continuous-delivery orchestrator. Automates build, test, and deploy phases against the release model defined per pipeline.

## Trade-offs

- Stage/action model is rigid. Linear pipelines fit cleanly;
  fan-out, conditional approvals, and matrix builds require
  workarounds (Lambda actions, parallel-stage tricks). Mature
  teams often outgrow it.
- Per-pipeline-per-month pricing plus per-execution. Many small
  pipelines cost more than fewer larger ones; consolidate
  related deployments where it makes sense.
- vs. GitHub Actions / GitLab CI / Jenkins / Argo Workflows:
  CodePipeline integrates natively with CodeBuild and CodeDeploy
  and accepts cross-region/account artefacts cleanly. Dedicated
  CI tools win on author/review UX and ecosystem.
