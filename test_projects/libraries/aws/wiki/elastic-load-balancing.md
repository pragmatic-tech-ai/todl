# Elastic Load Balancing

## Purpose

Managed L4/L7 traffic distribution across EC2 instances, containers, and IP targets. Four flavours: Application LB (L7), Network LB (L4 TCP), Gateway LB (third-party appliances), and Classic LB.

## Trade-offs

- Picking the wrong flavour is a rewrite, not a config flip. ALB
  for HTTP/HTTPS with path or host routing, NLB for static IPs /
  millions of TPS / non-HTTP, GWLB for inline third-party
  appliances. Classic LB is legacy and shouldn't be chosen for
  new work.
- LCU-based pricing rewards designs that don't fan out cross-AZ.
  ALB and NLB both charge per LCU plus cross-AZ data, so a
  single-AZ-pinned topology can be materially cheaper than the
  default multi-AZ one — at the cost of an obvious failure mode.
- vs. API Gateway: ALB is far cheaper at high RPS but offers no
  per-key throttling, no usage plans, no request validation, no
  WAF-aware auth. Use ALB for app traffic where those features
  aren't needed; reach for API Gateway when public-API policy
  matters.
