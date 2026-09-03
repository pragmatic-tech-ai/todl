# Site-to-Site VPN

## Purpose

AWS Virtual Private Network suite. Encrypted IPsec tunnels (Site-to-Site VPN) plus client-VPN remote access bridging on-premises networks and remote workers into AWS-resident VPCs.

## Trade-offs

- Per-tunnel throughput caps around 1.25 Gbps. High-bandwidth sites
  must spread traffic across multiple tunnels via ECMP or step up
  to Direct Connect; a single tunnel will silently throttle under
  burst.
- Traffic crosses the public internet. Latency and jitter are
  carrier-dependent and out of your control — fine for control
  plane or low-volume integration, painful for replication, voice,
  or anything latency-sensitive.
- vs. Direct Connect: VPN provisions in minutes vs. weeks and
  pairs naturally as the failover tier under DX. Pure-VPN
  production is fine for small footprints; pure-DX without VPN
  fallback is the hidden SPOF most often missed in design review.
