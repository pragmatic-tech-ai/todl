# OpsWorks

## Purpose

Managed Chef and Puppet for server configuration management. Three offerings: OpsWorks for Chef Automate, OpsWorks for Puppet Enterprise, and OpsWorks Stacks.

## Trade-offs

- Deprecated in 2024. OpsWorks Stacks, Chef Automate, and
  Puppet Enterprise variants are all on a sunset path; existing
  workloads need an exit plan, not a tuning plan.
- Migration target depends on configuration shape: per-host
  config management → Systems Manager State Manager + Ansible;
  multi-host orchestration → CloudFormation / Terraform; modern
  app deployment → containers with declarative manifests.
- Catalogue entry retained for legacy reference only. Any
  diagram still showing OpsWorks is a sign of stale
  architecture, not a working dependency.
