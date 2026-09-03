# VMware Cloud on AWS

## Purpose

Joint VMware + AWS offering running vSphere on Amazon EC2 bare metal. Lets existing VMware estates migrate or extend into AWS without re-platforming.

## Trade-offs

- Status uncertain after Broadcom's VMware acquisition. Licensing
  terms, partner-program shape, and pricing have shifted multiple
  times; AWS's rebranding to "Elastic VMware Service" reflects
  that transition. Multi-year commits warrant fresh legal/comm
  review.
- Expensive vs. native AWS. Host-based pricing on bare-metal
  EC2 plus VMware licensing makes VMC the "least-disruptive
  migration path", not the cost-optimal path. Many VMware
  workloads come out cheaper on AWS-native EC2 or container
  platforms once refactored.
- vs. Azure VMware Solution / Google Cloud VMware Engine:
  feature-equivalent at the vSphere layer; differentiation is
  ecosystem integration with the surrounding cloud. Pick by
  which cloud the team plans to use beyond the VMware lift.
