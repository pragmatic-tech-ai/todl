# Amazon VPC

## Purpose

Tenant-scoped software-defined network in AWS. Provisions a logically isolated section of the cloud with full control over IPv4/IPv6 addressing, subnets, route tables, and network gateways.

## Trade-offs

- Primary CIDR block can't be resized after creation. Under-sizing
  forces secondary CIDRs (which don't all behave like the primary
  for IPAM and certain service endpoints) or multi-VPC architectures
  whose Transit Gateway charges quickly exceed the cost of an
  over-allocated /16.
- Routing is subnet-attached, not VPC-global. Reasoning about
  effective routes for a packet involves the originating subnet's
  route table, NACLs, security groups, gateway/endpoint policies,
  and any TGW/peering route — material harder to debug than the
  flat VPC routing of Azure or GCP.
- Dual-stack IPv6 works but service coverage is uneven: a handful
  of services and some marketplace AMIs still assume IPv4. A pure
  v6-only architecture is achievable but pays an ongoing cost in
  workarounds.
