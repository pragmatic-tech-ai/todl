# AWS Cloud9

## Purpose

Browser-based IDE with tools for popular languages preinstalled. Supports serverless application development from anywhere with a network connection.

## Trade-offs

- Discontinued for new customers. AWS announced no new Cloud9
  customers; existing environments work but the editor has
  fallen behind VS Code-class tooling. Greenfield IDE work
  should not target Cloud9.
- Migration targets are VS Code (with the Remote SSH or
  Remote Containers extensions) connecting to a SageMaker
  Studio Code Editor, EC2, or Codespaces-equivalent. The
  workflow is similar; the editor is much better.
- vs. GitHub Codespaces / Coder / Gitpod: dedicated cloud-IDE
  vendors lead on performance and customisability. Cloud9's
  niche disappeared; this entry exists for legacy reference.
