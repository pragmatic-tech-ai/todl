# Amazon Redshift Serverless

## Purpose

Auto-provisioning, auto-scaling variant of Redshift. Skips cluster sizing for unpredictable analytic workloads, billed by capacity actually consumed.

## Trade-offs

- Base capacity (RPUs) has a real floor — minimum 8 RPUs, billed
  per RPU-second when queries run. "Pay nothing when idle" is
  honest, but the burst rate is high enough that a sustained
  workload often costs more than provisioned.
- Cold-start lag and warm-up behaviour are observable. First
  queries after idle pay a measurable warm-up; latency-sensitive
  dashboards may notice. Some teams set up a scheduled keep-warm
  query, which partially defeats the serverless billing model.
- vs. provisioned Redshift: serverless wins on intermittent or
  spiky analyst use and quick POCs; provisioned wins on stable
  high-throughput workloads where capacity planning pays back.
  The break-even is workload-shape, not query count.
