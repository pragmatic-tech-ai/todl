# AWS Resource Access Manager

## Purpose

Cross-account resource sharing across AWS Organizations. Lets you expose transit gateways, subnets, Route 53 Resolver rules, and other shared resources to other accounts without copying them.

## Trade-offs

- Resource-coverage is enumerated, not universal. Only specific
  resource types support RAM (TGW, subnets, Route 53 Resolver
  rules, License Manager configs, and a growing list). For
  unsupported types, cross-account access still flows through
  IAM resource policies and assume-role patterns.
- The model is "share, then consumer attaches". Sharer retains
  cost ownership of the resource — that's how RAM ends up
  centralising network costs in shared-services accounts. Plan
  account-billing implications before standing up shares.
- vs. duplicating resources per account: RAM is the cleaner
  pattern for hub-and-spoke topologies (shared TGW, shared
  Resolver rules). Per-account duplication is simpler for
  small estates; RAM pays back at multi-account scale.
