# AWS License Manager

## Purpose

License-rule engine for Microsoft, SAP, Oracle, IBM, and other vendors. Enforces licensing at EC2 instance launch across AWS and on-premises servers.

## Trade-offs

- Required when commercial-software licensing (Windows Server,
  SQL Server BYOL, Oracle, SAP) demands tracking by core, host,
  or socket. Optional but useful for non-BYOL workloads.
- Dedicated Host tracking is its strongest feature — and the
  most operationally awkward. License-bound Dedicated Hosts
  reduce the elasticity that makes AWS appealing; deciding when
  the licensing math pays back vs. just paying for
  license-included AMIs takes real analysis.
- vs. Flexera / Snow / vendor-specific tooling: commercial SAM
  vendors lead on multi-vendor coverage, audit-defense workflows,
  and policy modelling. License Manager is the AWS-side
  enforcement primitive; SAM tooling sits above it.
