# AWS B2B Data Interchange

## Purpose

Managed EDI transformation service. Converts X12 and other standardised B2B formats into JSON or XML for downstream integration, with trading-partner onboarding handled through a low-code interface.

## Trade-offs

- EDI is a hard domain regardless of the tool. The service smooths
  transformation but does not remove the standards literacy
  (X12, EDIFACT), trading-partner quirks, or certification work
  the team needs to onboard partners.
- vs. Cleo / OpenText / SPS Commerce: established B2B vendors
  bring deep partner libraries and pre-certified maps. AWS B2B
  Data Interchange is newer with thinner out-of-the-box partner
  coverage; weigh the partner catalogue, not just the per-
  transaction price.
- Pricing per transaction is competitive at low-to-mid volume.
  High-volume EDI traffic can flip the calculus toward owning
  (or co-locating) a dedicated EDI gateway, because each
  transaction is a chargeable event in the AWS model.
