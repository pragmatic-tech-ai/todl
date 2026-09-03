# AWS Launch Wizard

## Purpose

Guided sizing and deployment wizard for third-party workloads — SQL Server Always On, HANA-based SAP — that emits CloudFormation templates as a starting baseline.

## Trade-offs

- Bootstrap tool. Useful for "deploy a known third-party
  workload according to a documented best practice" — SAP HANA,
  SQL Server Always On, Active Directory. Outside that
  narrow catalogue, irrelevant.
- Output is a starting CloudFormation template. Treat it as a
  scaffold to customise, not as ready-for-production. Generated
  templates often need security-hardening, observability, and
  backup additions.
- vs. AWS Quick Starts / vendor-provided AMIs and Marketplace
  templates: Launch Wizard updates with AWS-blessed sizing
  guidance, which Quick Starts sometimes lag. Both are scaffold
  generators, not platforms.
