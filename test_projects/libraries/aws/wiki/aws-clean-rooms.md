# AWS Clean Rooms

## Purpose

Multi-party analytics environment where partner organisations can join and analyse combined datasets without exposing the underlying rows. Useful for advertising-campaign and R&D collaboration.

## Trade-offs

- All parties must onboard to AWS Clean Rooms. Cross-cloud
  collaboration is awkward — a partner on Snowflake Data Clean
  Rooms or LiveRamp Safe Haven needs an AWS path. In ad-tech
  particularly, partner mix is the deciding factor.
- Analysis rules constrain what queries can be authored.
  Aggregation thresholds, allowed joins, and column-level
  restrictions limit query shapes — by design — but surprise
  analysts used to free-form SQL.
- vs. Snowflake / Habu: feature parity is closing but Clean
  Rooms ML for lookalike modelling is newer than peers' offerings.
  Evaluate identity-resolution, partner-onboarding ergonomics, and
  privacy primitives (differential privacy controls) per use case
  rather than assuming feature equivalence.
