# AWS Identity and Access Management

## Purpose

Fine-grained access control for AWS services and resources. Users, groups, and roles paired with policies specifying who may do what under which conditions.

## Trade-offs

- Foundational, irreducible, and unforgiving. Misconfigured IAM
  is the single most common AWS-attack vector. Production
  estates need rigorous policy review, IAM Access Analyzer, and
  organisational SCPs — IAM does not "just work" safely.
- Policy language (JSON) is more powerful and more brittle than
  it looks. Implicit deny, explicit deny, condition operators,
  and policy evaluation across identity-based, resource-based,
  permissions-boundary, and SCP layers produce non-obvious
  effective access. Wrong policies are usually too permissive,
  not too restrictive.
- IAM Users with long-lived access keys are now considered
  legacy. Best practice is Identity Center for humans + IAM
  Roles for workloads, with access keys reserved for narrow
  CI/CD use and rotated frequently.
