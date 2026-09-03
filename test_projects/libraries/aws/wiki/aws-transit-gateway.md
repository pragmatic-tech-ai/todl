# AWS Transit Gateway

## Purpose

Hub-and-spoke gateway connecting many VPCs and on-premises networks through a single managed routing fabric. Replaces hand-managed VPC-peering meshes.

## Trade-offs

- Cost scales with attachment count and per-GB processing on every
  byte transiting. Below five-or-so VPCs, plain peering is
  significantly cheaper; the TGW pays back when peering would
  produce an O(n²) mesh that ops genuinely can't manage.
- Per-GB processing applies to return traffic too. Chatty east-west
  workloads (replication, log shipping, internal service calls)
  through a TGW can multiply the network bill compared with keeping
  the workload in one VPC.
- New mental model: route tables × associations × propagations.
  Easier to evolve than a peering matrix but materially harder than
  flat single-VPC routing — design reviewers need to internalise
  the model or they will mis-attribute connectivity failures.
