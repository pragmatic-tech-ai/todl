# Amazon Route 53

## Purpose

AWS managed authoritative DNS and domain registration service. Resolves domain names to IP addresses, with traffic-flow policies (latency-based, weighted, geo), health checks, and IPv6 support.

## Trade-offs

- ALIAS records to AWS resources (ALB, CloudFront, S3 website) are
  free at query time and resolve to live targets; equivalent
  CNAME chains to external endpoints bill per million queries
  and add a DNS hop.
- Health-check-driven failover is tied to Route 53's checker fleet;
  the checks themselves have no DNS-level retry semantics and a
  flapping endpoint can flip records faster than downstream
  resolvers' TTLs cache them, producing user-visible split-brain.
- Traffic-flow policies (weighted, geo, latency, geoproximity) are
  expressive but locked into Route 53's editor — migrating to another
  DNS vendor means reconstructing the routing logic from screenshots
  and exported JSON, not a portable zone file.
