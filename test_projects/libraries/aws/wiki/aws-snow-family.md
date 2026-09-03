# AWS Snow Family

## Purpose

Family of ruggedised edge-and-transfer appliances — Snowball and Snowball Edge — for environments with limited connectivity or austere physical conditions.

## Trade-offs

- Umbrella label — see [`aws-snowball`](aws-snowball.md) and
  [`aws-snowball-edge`](aws-snowball-edge.md) for the actual
  devices. Snowmobile (the truck) was retired.
- Use case is "the network is the bottleneck". Multi-petabyte
  migrations, disconnected environments, ship/oil-platform
  data sync. For network-feasible transfers (under tens of
  TB on decent bandwidth), DataSync or S3 multipart upload is
  simpler.
- Time-to-AWS dominates the project plan. Order lead time +
  on-site loading + courier transit + AWS-side restore can
  stretch to weeks. Plan accordingly; this is logistics, not
  software.
