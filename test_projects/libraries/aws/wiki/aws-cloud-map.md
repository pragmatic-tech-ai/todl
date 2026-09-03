# AWS Cloud Map

## Purpose

Cloud resource discovery and naming service. Maintains current location of dynamic application resources, with built-in health checks so dependent services always resolve to a healthy endpoint.

## Trade-offs

- Narrow niche: useful when running outside a service mesh and
  outside an orchestrator that already does discovery (ECS Service
  Connect, EKS DNS). If a mesh or Connect already handles
  resolution, Cloud Map adds a registry to maintain without
  obvious gain.
- DNS-based discovery inherits TTL staleness — fast scale-down
  events leave dead endpoints in resolver caches for the TTL
  window. API-based discovery side-steps it but forces application
  code changes that defeat "just use DNS" simplicity.
- vs. ECS Service Connect: Connect is newer, simpler, and
  ECS-native. Cloud Map remains the cross-compute option (mixing
  ECS + Lambda + EC2 + on-prem) and the only option for custom
  attributes that aren't just IP:port.
