# Amazon OpenSearch Serverless

## Purpose

Serverless tier of OpenSearch Service. Runs petabyte-scale search and analytics workloads without configuring or managing clusters, and includes a vector engine for ML-augmented search.

## Trade-offs

- OCU-based pricing has a real floor. Minimum 2 OCUs for indexing
  and 2 for search means a small workload pays the cost of an
  always-on small cluster, not "zero when idle". Cost only beats
  provisioned at modest sustained load.
- Feature gaps vs. provisioned OpenSearch are intentional and
  changing. Hot/warm/cold tiering, certain cluster-wide settings,
  and some plugins aren't exposed. Check feature parity for the
  specific access patterns before commitment.
- Vector-search collection type is separate from time-series and
  search collection types — they can't be mixed. Multi-modal
  apps end up running multiple collections with the cost
  multiplication that implies.
