# Amazon CodeCatalyst

## Purpose

Integrated CI/CD product for software-delivery teams. Plan, code, build, test, and deploy through a single managed pane, with AWS account connections for resource integration.

## Trade-offs

- Newer integrated CI/CD product trying to replace the legacy
  Code-Star/CodeCommit/CodeBuild story. Adoption is uneven —
  the team needs to commit to it as the primary tool, not
  bolt it on alongside GitHub Actions.
- vs. GitHub / GitLab / Bitbucket: the dominant developer
  platforms lead on ecosystem reach (Actions/Pipelines, third-
  party integrations, code-review UX). CodeCatalyst wins on
  AWS-native account connections and blueprints; loses on
  developer-experience polish.
- Pricing is per-active-user. Estates with many casual viewers
  (PMs, designers, analysts) cost more here than on
  GitHub/GitLab where seat counts are usually narrower.
