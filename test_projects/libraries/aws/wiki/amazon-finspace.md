# Amazon FinSpace

## Purpose

Analytics service purpose-built for financial services. Ships with a library of 100+ time-series functions (time bars, Bollinger bands) and accelerates discovery and preparation of petabyte-scale financial datasets.

## Trade-offs

- Vertical scope. Pricing, packaging, and feature set assume
  financial-services workloads (time-series analytics, kdb+
  compatibility, regulated data). Outside that vertical, the
  cost-to-value ratio is bad — Athena, EMR, or Glue does the same
  analytical work for less.
- High floor cost. Even modest FinSpace usage involves cluster-
  scale spend; this is not a "turn it on for a single analyst"
  service. Justification needs a team-scale or desk-scale data
  workload.
- kdb+ integration is the differentiator. If the data isn't kdb+
  shaped or doesn't benefit from FinSpace's pre-built time-series
  functions, the rest of the service is a general-purpose
  analytics platform priced for finance.
