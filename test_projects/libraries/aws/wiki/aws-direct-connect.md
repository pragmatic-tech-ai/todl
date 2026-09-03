# AWS Direct Connect

## Purpose

Dedicated network circuit between an on-premises data center and AWS. Provides private bandwidth, lower cost, and more consistent performance than public-internet transit.

## Trade-offs

- Provisioning is weeks, not minutes: a physical cross-connect at
  a Direct Connect location involves a partner carrier, a port
  order, and an LOA-CFA hand-off. Treat DX as long-lead
  infrastructure, not an ad-hoc resource.
- Cost model only pays back at sustained scale: monthly port-hour
  fees plus a low per-GB egress rate beat internet egress only
  past tens of TB per month. Below that, Site-to-Site VPN with
  bursty internet egress is cheaper.
- A single circuit is a single failure domain. Production designs
  pair two ports across different DX locations with diverse
  carriers and keep Site-to-Site VPN as a tertiary fallback; a
  one-port deployment is the canonical hidden SPOF.
