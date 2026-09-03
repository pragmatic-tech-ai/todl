# Amazon File Cache

## Purpose

High-speed cache fronting on-premises file systems and AWS file/object stores. Sub-millisecond access for processing pipelines that read from heterogeneous, possibly distant, data sources.

## Trade-offs

- Specialised tool for hybrid HPC / EDA / media-processing
  workflows where on-prem-resident data needs cloud-side
  acceleration. Outside that pattern, the dedicated-cache
  pricing rarely pays back.
- Lustre-derived. Inherits Lustre's behaviour and quirks —
  POSIX compatibility is strong but not perfect; small-file
  metadata workloads degrade compared to NFS-shaped use.
- vs. FSx for Lustre with linked S3 / direct on-prem mount:
  FSx for Lustre is the more general primitive when source data
  lives in S3. File Cache wins when source data lives on
  multiple heterogeneous NFS servers that you can't move.
