# AWS CodeBuild

## Purpose

Managed build service that compiles source, runs tests, and produces deployable packages. Pre-packaged build environments plus support for custom ones.

## Trade-offs

- Per-build-minute pricing on configurable instance sizes.
  Heavy workloads benefit from larger instances despite higher
  per-minute cost — wall-clock time often dominates. Run-it-on-
  the-cheapest-tier reflex usually overspends.
- buildspec.yml is its own DSL with its own quirks. Local
  reproduction requires the codebuild-local Docker image and
  doesn't capture every behaviour difference. Teams that move
  to CodeBuild from GitHub Actions miss the "test the workflow
  locally" capability.
- vs. GitHub Actions / GitLab CI / CircleCI: dedicated CI
  vendors lead on developer experience, matrix builds, and
  marketplace actions. CodeBuild wins on AWS-native IAM access
  to private resources and tight integration with CodePipeline.
