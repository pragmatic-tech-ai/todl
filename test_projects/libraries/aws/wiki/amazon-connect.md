# Amazon Connect

## Purpose

Cloud contact-centre platform based on the technology behind Amazon's customer-service. Pay-by-the-minute, no per-seat licensing, with self-service flow design.

## Trade-offs

- Pay-per-minute is appealing on the surface but bundles separate
  charges (telephony minutes, Lex queries, Lambda invocations,
  Connect Cases/Tasks, recording storage, transcribe). Real
  bills are higher than the per-minute headline suggests; model
  the full flow.
- Customisation is via flows, Lex bots, and Lambda. Genuinely
  custom workflows mean real engineering work; "no-code contact
  centre" is true for the simple cases and stops being true at
  enterprise-routing complexity.
- vs. Genesys Cloud / Five9 / NICE inContact: incumbent CCaaS
  vendors lead on WFM, QM, and agent-experience features.
  Connect wins on AWS-native integration, pay-per-use pricing,
  and AWS-resident customer-data residency.
