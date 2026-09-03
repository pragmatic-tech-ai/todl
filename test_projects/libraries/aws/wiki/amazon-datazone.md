# Amazon DataZone

## Purpose

Business data catalog and access-governance layer. Publishes datasets from Redshift, Athena, Glue, Lake Formation, and external SaaS sources through a personalised web portal.

## Trade-offs

- Setup is heavier than it appears. Domains, projects, environment
  blueprints, and trust relationships between accounts all require
  coordination before any dataset is published. Small estates may
  find the governance ceremony costs more than it returns.
- vs. Collibra / Alation: DataZone is AWS-deep and SaaS-shallow.
  If the catalog needs to span Snowflake, dbt, Looker, Tableau, and
  on-prem warehouses, specialist catalogs cover wider surface; if
  the data lives mostly in AWS analytics services already,
  DataZone integrates more cleanly.
- Access governance still depends on Lake Formation underneath.
  DataZone is the portal and curation layer, not the enforcement
  point. Misunderstanding that boundary leads to authorisation
  surprises.
