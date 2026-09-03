# Amazon WorkSpaces Core

## Purpose

Cloud-based VDI infrastructure accessible to third-party VDI management products. Combines existing VDI software with AWS reliability and a 99.9% SLA.

## Trade-offs

- Hybrid posture between WorkSpaces and self-managed VDI on
  EC2. Useful when the team has investment in a VDI broker
  (Citrix, VMware Horizon) but wants AWS-managed compute
  underneath.
- Adds a layer to the operations model. Two vendors (the VDI
  broker and AWS) are in the path for any incident. Make sure
  the on-call story spans both.
- Niche audience. Most organisations either commit to AWS-
  native (WorkSpaces) or self-manage the full stack; WorkSpaces
  Core's middle position works for specific Citrix/VMware
  estates already in transition.
