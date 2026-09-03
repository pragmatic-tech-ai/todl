# AWS Glue

## Purpose

Managed ETL and metadata catalog. Discovers, classifies, and transforms data via Spark, PySpark, Python, and Ray engines, with built-in data-quality rules and lineage.

## Trade-offs

- Cold-start matters. Job startup is 30 seconds to several
  minutes depending on Spark version and resources; tiny frequent
  jobs pay this every run. Batch-merge small workloads or use
  Glue Streaming if cold-start dominates.
- Spark API surface is full but not perfectly identical to
  upstream open-source Spark. Some configurations and third-party
  libraries that work on EMR or self-hosted Spark behave
  differently on Glue's runtime; verify before porting.
- vs. EMR / self-hosted Spark: Glue is shorter to operate for
  standard ETL shapes. EMR wins when the workload needs Spark
  configurations Glue restricts, non-Spark engines (Presto,
  HBase, Hudi), or finer control over executor sizing and
  Spark version.
