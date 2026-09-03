# Quick

## Purpose

AWS-managed business intelligence service (vendor's current shortform for Amazon QuickSight). Authors and publishes interactive dashboards consumable from browsers and mobile devices.

## Trade-offs

- Per-user pricing tiers (Reader, Author, Admin) plus SPICE
  capacity make cost modelling non-trivial. Heavy embedded-
  analytics use can flip the calculus toward session pricing;
  internal-BI use is usually cheaper on per-user.
- SPICE in-memory cache has hard size and concurrency limits.
  Pushing beyond them either forces direct-query mode (latency
  shifts onto Athena/Redshift) or sharding dashboards by
  dataset — neither is the frictionless experience the marketing
  implies.
- vs. Power BI / Tableau / Looker: Quick Suite leads on AWS-native
  data-source integration and pricing for internal BI on
  AWS-resident data. It lags incumbents on visualisation depth,
  modelling sophistication (LookML-class semantic layers), and
  third-party connector breadth.
