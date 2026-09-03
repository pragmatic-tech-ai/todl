# AWS Billing Conductor

## Purpose

Customised billing for AWS Solution Providers and large enterprises. Generates pro-forma bills for showback or chargeback to internal teams and downstream customers.

## Trade-offs

- Pro-forma billing, not real billing. Billing Conductor
  generates internal showback/chargeback views; AWS still
  bills the management account at its real prices. Helpful for
  internal accountability, not for changing what AWS actually
  charges.
- Useful primarily for AWS Solution Providers and large
  multi-BU enterprises with internal chargeback. Small or
  single-team estates rarely need it.
- vs. CloudHealth / Apptio Cloudability / native CUR analysis:
  third-party FinOps platforms do the same chargeback with
  more flexibility and multi-cloud reach. Billing Conductor
  wins when AWS-native pro-forma invoices are the format
  needed.
