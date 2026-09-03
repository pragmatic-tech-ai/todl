# Amazon Linux 2023

## Purpose

AWS-curated Linux distribution optimised for EC2 (including Graviton). Up to five years of major-release support and tight integration with AWS services.

## Trade-offs

- Fedora-derived rolling base with a 5-year support promise.
  Newer-than-RHEL packages help with modern toolchains but
  occasionally surface compatibility issues with vendor
  binaries built for RHEL/CentOS. Verify ISV support per
  workload.
- vs. Ubuntu LTS / RHEL / Rocky / Alpine: AL2023 wins on tight
  AWS integration (cloud-init defaults, IMDS v2 defaults,
  SSM agent pre-installed). Ubuntu LTS has wider ecosystem
  support; RHEL has commercial vendor support; Alpine wins
  on minimal container footprint. Pick by team familiarity
  and ISV requirements.
- Migration from Amazon Linux 2 is real work, not a swap.
  systemd unit changes, glibc version bumps, and package
  renames break some workloads. Treat as a major-version
  upgrade.
