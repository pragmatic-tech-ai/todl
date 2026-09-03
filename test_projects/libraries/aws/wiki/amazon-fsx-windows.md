# Amazon FSx for Windows File Server

## Purpose

Managed native Windows file system on SMB with NTFS semantics, Active Directory integration, and Distributed File System support. Lifts-and-shifts Windows applications that depend on SMB shares.

## Trade-offs

- Tightly coupled to Active Directory. AWS Managed Microsoft AD,
  Self-managed AD, or a hybrid is non-negotiable; auth model
  carries real operational weight. Windows file-share posture
  in AWS means AD posture in AWS.
- Right tool for SMB-dependent Windows workloads — file servers
  for user home directories, departmental shares, Windows
  applications expecting SMB. Wrong tool for cross-platform
  shared storage where NFS via EFS or S3 fits.
- Per-GB and throughput-tier pricing is meaningful. Windows
  applications that hit FSx for Windows hard (CAD/design,
  large media editing) pay a real bill; budget the throughput
  tier with the same care as a database I/O tier.
