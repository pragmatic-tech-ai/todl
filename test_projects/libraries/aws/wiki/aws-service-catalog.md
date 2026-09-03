# AWS Service Catalog

## Purpose

Internal catalog of approved IT services — VM images, servers, databases, application stacks — for self-service deployment within governance constraints.

## Trade-offs

- CloudFormation-template-based. Products are CFN templates; the
  Service Catalog adds approval workflow, versioning, and IAM
  isolation. Teams that use Terraform or CDK directly often
  find Service Catalog awkward.
- The "catalog" abstraction fits compliance-heavy organisations
  (financial services, healthcare, public sector) where every
  deployment must come from a vetted template. For typical
  dev-team-empowered estates, Service Catalog adds friction
  that doesn't pay back.
- vs. self-service IaC patterns / Backstage scaffolder: modern
  platforms tend to make IaC available with PR-based review
  rather than wrapping it in Service Catalog. Service Catalog
  survives in estates where the answer must be "no" until
  approved.
