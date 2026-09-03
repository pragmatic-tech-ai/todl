# AWS DataSync

## Purpose

Online bulk-data transfer between on-premises storage and S3 or EFS. Up to 10x faster than open-source alternatives via an on-premises software agent.

## Trade-offs

- Per-GB pricing on transferred data. Cheap at small scale,
  expensive at huge scale — at multi-petabyte transfers,
  Snowball is often cheaper than network transfer.
- Network bandwidth to AWS is the real constraint. The DataSync
  agent maximises throughput on whatever pipe exists; if that
  pipe is small, the migration is still slow. Verify the
  available bandwidth before promising migration timelines.
- vs. rsync / rclone / Snow Family: rsync is free and fine for
  small transfers and ongoing syncs; rclone for cross-cloud;
  Snow Family for shipping disks when bandwidth is the
  bottleneck. DataSync wins for one-shot, repeatable,
  agent-managed bulk transfers up to ~tens of TB.
