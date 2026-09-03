# Amazon FSx for NetApp ONTAP

## Purpose

NetApp-managed ONTAP filer running as a managed AWS service. Provides familiar ONTAP features, APIs, NFS, SMB, and iSCSI for customers consolidating NetApp estates into AWS.

## Trade-offs

- Costs ONTAP money on top of AWS money. NetApp's pricing is
  baked into the service, making FSx for ONTAP among the most
  expensive AWS storage options. The trade-off is decades of
  ONTAP-specific features (SnapMirror, FlexClone, compression,
  dedup).
- Right tool only when existing ONTAP estates need to extend to
  AWS or specific ONTAP features (multi-protocol with locking
  consistency, app-aware snapshots) are required. Greenfield
  workloads almost always do better on EFS, S3, or FSx for
  OpenZFS.
- vs. FSx for OpenZFS: OpenZFS gives most of the modern ZFS
  features (snapshots, compression, clones) at lower cost
  but without the ONTAP API surface or SnapMirror replication
  to on-prem ONTAP. Pick by ecosystem, not benchmark.
