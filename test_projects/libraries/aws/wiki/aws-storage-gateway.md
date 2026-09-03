# AWS Storage Gateway

## Purpose

Hybrid storage bridge presenting NFS, SMB, and iSCSI endpoints on-premises while backing them with S3, Glacier, EBS, and FSx for Windows File Server.

## Trade-offs

- Three flavours (File, Volume, Tape) serve different patterns
  — and the wrong choice forces a rebuild. File Gateway for
  NFS/SMB-to-S3, Volume Gateway for iSCSI-backed-by-EBS, Tape
  Gateway for legacy backup software needing virtual tape.
  Pick by the on-prem protocol need.
- Local-cache sizing is load-bearing. Under-sized cache = slow
  read latency for non-resident data; over-sized cache = wasted
  on-prem hardware. Tune to the working set, not headline
  capacity claims.
- vs. direct S3 + tools / Mountpoint for S3 / Snow Family:
  Mountpoint for S3 has reduced the need for File Gateway for
  modern Linux workloads; Snow Family suits bulk migration
  rather than ongoing access. Storage Gateway remains the right
  answer for legacy SMB/NFS/iSCSI consumers that can't be
  changed.
