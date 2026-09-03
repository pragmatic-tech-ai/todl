# Amazon Detective

## Purpose

Security-investigation graph built automatically from AWS log data. Uses ML, statistics, and graph theory to surface the root cause of suspicious activity.

## Trade-offs

- Requires GuardDuty to be useful. Detective is the investigation
  layer on top of GuardDuty alerts; without GuardDuty's
  signal, Detective has little to graph. Plan as a pair, not
  as an independent purchase.
- Cost per GB ingested can grow surprisingly. Multi-account
  organisations with CloudTrail volume across many regions
  produce more ingestion than the per-account pricing examples
  suggest. Model the total log volume before enabling
  organisation-wide.
- vs. Splunk Enterprise Security / Sumo Logic Cloud SIEM /
  vendor XDR: dedicated SIEMs handle multi-cloud, on-prem, and
  application-layer signals that Detective does not. Detective
  wins on tight AWS-native integration; SIEMs win on coverage
  breadth.
