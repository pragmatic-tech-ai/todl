# Amazon EMR

## Purpose

Managed big-data platform running Spark, Hive, HBase, Flink, Hudi, and Presto. Deploys on EC2, EKS, or on-premises via EMR on AWS Outposts.

## Trade-offs

- Cluster startup is minutes (10-15 for cold provisioned EMR-on-EC2).
  Transient-cluster designs that spin up per-job pay this every time;
  long-running shared clusters amortise it but reintroduce capacity
  planning and noisy-neighbour issues.
- Three deployment modes (EC2, EKS, Serverless) are not
  interchangeable. EMR Serverless removes capacity planning but
  caps some Spark configurations and adds cold-start pricing;
  EMR on EKS suits teams already running Kubernetes; classic EMR
  on EC2 has the deepest feature set and the most ops burden.
- vs. Glue / Athena: EMR is the right answer when the workload
  needs Spark APIs the Glue runtime doesn't fully expose, custom
  JARs, or non-Spark engines (Presto, HBase, Hudi). For most
  ETL-shaped Spark jobs, Glue is shorter to operate.
