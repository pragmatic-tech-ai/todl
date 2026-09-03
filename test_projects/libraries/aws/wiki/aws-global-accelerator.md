# AWS Global Accelerator

## Purpose

Static-IP global anycast frontend for AWS-hosted applications. Routes user traffic across the AWS backbone to the nearest healthy regional endpoint, improving availability and latency.

## Trade-offs

- vs. CloudFront: GA is a TCP/UDP-layer accelerator with no caching
  — choose it for non-HTTP traffic (game protocols, MQTT, custom
  TCP) or when downstream firewalls require a stable allowlist of
  IPs. For HTTP workloads, CloudFront usually does the same job at
  lower cost because it can serve from cache.
- Fixed accelerator-hour fee per accelerator + per-GB transfer.
  At low RPS the fixed cost dominates; GA pays off when traffic is
  globally distributed and large enough to amortise the per-hour
  charge.
- Static-IP guarantee is what you're really buying: two anycast
  IPs that stay constant across endpoint changes, so partner
  firewall allowlists keep working. If you don't need that, a
  Route 53 latency-routed setup is simpler.
