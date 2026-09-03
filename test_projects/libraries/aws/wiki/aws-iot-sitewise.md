# AWS IoT SiteWise

## Purpose

Industrial-IoT data platform. Collects data from on-premises servers via MQTT or APIs, models industrial assets, computes metrics, and surfaces them through web applications.

## Trade-offs

- Asset-modelling layer is genuinely useful for industrial use
  cases (hierarchies of equipment, computed metrics, derived
  KPIs). Generic IoT workloads don't need that abstraction
  and often find SiteWise heavier than they want.
- SiteWise Edge gateway makes OPC-UA / Modbus / EtherNet-IP
  ingestion easier than rolling your own; the gateway has its
  own operational model (deployment, updates, monitoring).
- vs. AVEVA PI / Honeywell Forge / GE Smart Signal: industrial
  data historians lead on production-grade plant operations,
  high-resolution storage, and engineer-friendly UX. SiteWise
  wins on AWS-native ML integration and modern API surface;
  rarely replaces a historian outright in established
  operations.
