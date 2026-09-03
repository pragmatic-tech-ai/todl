# Amazon EC2

## Purpose

Elastic Compute Cloud — AWS's core IaaS. Resizable virtual machines launched in minutes, billed by usage, with full control over instance type, storage, and networking.

## Trade-offs

- Default choice when nothing else fits, which makes it the
  most-overused service in AWS. Workloads that fit Lambda,
  Fargate, or App Runner reach for EC2 out of habit and pay
  ongoing operations cost for capacity planning, AMI patching,
  and orchestration glue.
- Instance-family selection has compounding cost effects.
  Wrong-fit families (memory-optimised for CPU-bound work,
  general-purpose for GPU-bound work, x86 where Graviton would
  do) easily double the bill. Periodic right-sizing is real
  work, not "set and forget".
- Reserved Instances and Savings Plans pay back at 1- and 3-year
  commits but lock in instance shapes. Right-sizing during a
  commit term is constrained — match commit duration to how
  stable the architecture really is, not how confident the
  roadmap feels.
