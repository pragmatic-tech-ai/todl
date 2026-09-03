# Amazon FSx for Lustre

## Purpose

Managed Lustre file system for HPC, ML, and media-processing workloads. Hundreds of GB/s throughput, millions of IOPS, sub-millisecond latency; integrates natively with S3.

## Trade-offs

- Workload shape is HPC / ML training / EDA / video pipeline. For
  generic Linux file-sharing workloads, EFS is cheaper and
  simpler. FSx for Lustre's parallel-IO architecture only pays
  off when the workload actually does parallel IO.
- Scratch vs. persistent deployment is a load-bearing choice.
  Scratch is significantly cheaper but data lives only for the
  duration of the job; persistent costs more but retains data.
  Confusing the two leads to lost data or wasted spend.
- S3 link is the differentiator. Lazy-loaded from S3, written
  back to S3 — that workflow makes FSx for Lustre genuinely
  useful for cloud-bursting. Without the S3 integration, you'd
  often pick a different file system.
