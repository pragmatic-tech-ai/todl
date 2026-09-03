# AWS Data Pipeline

## Purpose

Legacy ETL orchestrator moving data between AWS compute, AWS storage, and on-premises sources on a schedule. Largely superseded by Step Functions and MWAA for new workloads.

## Trade-offs

- Effectively deprecated. AWS announced no new Data Pipeline
  customers and steered the workload onto Glue, Step Functions,
  and MWAA. Greenfield ETL should not start here.
- Pipeline JSON definitions and the on-EC2 Task Runner model
  predate the modern serverless options. Operating these in
  parallel with a Glue/Step Functions estate is a long-term ops
  drag with no upside.
- Migration target depends on shape: schedule-driven SQL/ETL →
  Glue; complex multi-service orchestration → Step Functions;
  DAG-shaped Python pipelines with custom operators → MWAA.
