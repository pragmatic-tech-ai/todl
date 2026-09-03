# AWS Snowball

## Purpose

Smallest member of the Snow Family — 4.5 lbs, 8 TB usable storage. Targeted at first-responder, IoT, vehicular, and drone deployments.

## Trade-offs

- 8 TB usable is small compared to Snowball Edge or current
  bandwidth. Workloads at the small end of Snow Family
  typically have austere-environment requirements (truck-
  mounted, drone-loaded, first-responder) that justify the
  device shape.
- Per-job fee + per-day rental + shipping. Multiple Snowballs
  for one migration multiply the fees. Right-size by total
  data volume vs. device capacity.
- vs. Snowball Edge: Edge has more storage and compute. Use
  plain Snowball only when device weight and form factor
  drive the choice.
