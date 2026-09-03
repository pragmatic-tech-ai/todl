# Amazon FSx for OpenZFS

## Purpose

Managed file storage built on OpenZFS. Migrates on-premises file servers into AWS without application changes for organisations standardised on ZFS.

## Trade-offs

- NFS-only at GA; SMB and iSCSI are not on the roadmap. Estates
  that need multi-protocol access remain on FSx for ONTAP
  despite the cost difference.
- Newer than ONTAP / EFS, so the AWS-side feature set is still
  building out. Cross-region replication, fine-grained snapshot
  management, and certain advanced ZFS knobs may not yet match
  what an experienced ZFS admin expects.
- vs. EFS: OpenZFS gives true ZFS snapshots, clones, and
  compression that EFS doesn't. EFS scales elastically without
  pre-provisioning; OpenZFS requires upfront capacity sizing.
  Pick by feature need vs. operational simplicity.
