# Amazon Managed Workflows for Apache Airflow

## Purpose

Managed Apache Airflow orchestrator for data pipelines. Authors workflows as Python DAGs without managing the underlying scheduler, worker, or metadata-database infrastructure.

## Trade-offs

- Version is pinned per environment with disruptive upgrade paths.
  Airflow's own behaviour changes between minor versions; MWAA
  upgrades require an environment swap and DAG-level testing,
  not a transparent rolling update.
- Scheduler latency on small environment classes is real. DAGs
  set to fire every minute drift visibly on `mw1.small`; either
  oversize the environment or accept the jitter. Don't rely on
  Airflow for sub-minute precision.
- vs. Step Functions / Glue Workflows: MWAA is the right answer
  when DAGs are complex Python with custom operators and team
  Airflow expertise. Step Functions wins for AWS-native task
  orchestration; Glue Workflows fits ETL pipelines built on Glue.
