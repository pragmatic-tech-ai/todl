# AWS Organizations

## Purpose

Multi-account management plane. Programmatically creates accounts, groups them, applies SCPs for governance, and consolidates billing under a single payment method.

## Trade-offs

- SCPs are deny-only and don't grant permission. Misunderstanding
  this leads to over-broad IAM policies "justified by SCPs that
  catch any mistake" — SCPs are a backstop, not a substitute
  for IAM hygiene.
- OU restructuring after the fact is doable but painful.
  Account-membership changes trigger SCP re-evaluation; large
  reorganisations need maintenance windows and careful planning.
  Get the OU structure right early.
- Consolidated Billing alone doesn't require Organizations'
  governance features, but the two come bundled. Estates that
  want just consolidated billing inherit the governance surface
  whether they use it or not.
