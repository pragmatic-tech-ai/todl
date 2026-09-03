# AWS Systems Manager

## Purpose

Unified ops console for AWS and hybrid resources. Bundles Run Command, State Manager, Inventory, Patch Manager, Automation, Parameter Store, Distributor, and Session Manager.

## Trade-offs

- Constellation, not a service. Run Command, Session Manager,
  State Manager, Patch Manager, Parameter Store, Automation,
  Inventory — each has its own model and limitations.
  Architecture diagrams that show "Systems Manager" as one
  node mislead reviewers.
- Session Manager is the standout: SSH-without-SSH access to
  instances over IAM, with full session logging. Enabling it
  removes the need for bastion hosts and inbound port 22 —
  a meaningful security improvement most estates eventually
  adopt.
- Parameter Store is the under-priced sibling of Secrets
  Manager. For non-rotating config and most flags, Standard
  parameters are free; Advanced parameters add features at a
  per-parameter cost. Many secrets that don't need rotation
  belong here rather than in Secrets Manager.
