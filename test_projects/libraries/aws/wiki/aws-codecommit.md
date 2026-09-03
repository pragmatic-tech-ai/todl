# AWS CodeCommit

## Purpose

Managed private Git repository hosting. Works seamlessly with existing Git tools and eliminates the need to operate self-hosted source control.

## Trade-offs

- Effectively in maintenance. AWS announced no new CodeCommit
  customers; existing repos work but new investment is in
  CodeCatalyst. Greenfield work should not target it.
- Lacks modern Git-host features that developers expect: limited
  PR/code-review UX, weak project management, no Actions-class
  CI integrations, sparse third-party tool ecosystem.
- vs. GitHub / GitLab / Bitbucket: dominant Git hosts lead on
  collaboration features and ecosystem. CodeCommit's only edge
  was AWS-native IAM auth; for most teams that doesn't pay
  back the developer-experience tax.
