# AWS CloudFormation

## Purpose

Declarative IaC engine. Authors templates describing AWS resources, then provisions and updates them in dependency order.

## Trade-offs

- YAML/JSON templates lose readability past a few hundred
  resources. CDK (which synthesises to CFN) has effectively
  become the canonical authoring tool; raw CFN is fine for
  small stacks and unavoidable for some edge cases.
- Failed stack updates roll back, which sounds nice and is
  occasionally catastrophic. A failed rollback locks the stack
  in UPDATE_ROLLBACK_FAILED; recovering manually is real
  operational toil. Limit blast radius by sharding stacks.
- vs. Terraform / Pulumi: Terraform has wider provider coverage
  and faster parity with new AWS launches; CloudFormation has
  tighter AWS integration (drift detection, CFN Hooks, Service
  Catalog products). Mixed estates use Terraform for cross-cloud
  + CFN-via-CDK for AWS-deep.
