# AWS CodeArtifact

## Purpose

Managed package repository for Apache Maven, Gradle, npm, yarn, twine, pip, and NuGet. Centralises private and proxied public dependencies.

## Trade-offs

- Solves the npm / Maven Central rate-limiting and supply-
  chain-attack problems by proxying upstream. The setup +
  IAM-token integration is the work; once configured it
  largely runs.
- Per-request and per-GB-stored pricing is modest but real.
  Heavy CI/CD pipelines pulling many dependencies on every
  build pay enough to justify caching strategies (npm CI
  caches, Maven offline) alongside the proxy.
- vs. JFrog Artifactory / Sonatype Nexus / GitHub Packages:
  Artifactory leads on multi-format coverage (Docker, Helm,
  Chef, RubyGems, etc.) and policy features. CodeArtifact
  covers the major ecosystems and integrates natively with
  CodeBuild and ECR. Pick by format coverage need.
