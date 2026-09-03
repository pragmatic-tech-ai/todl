# AWS Entity Resolution

## Purpose

Record-matching and deduplication service. Links related records across applications, channels, and stores using configurable ML and rule-based matching to form unified customer profiles.

## Trade-offs

- ML matching is not magic. Out-of-the-box accuracy depends on
  data quality, attribute selection, and the chosen matching
  workflow; production-grade entity resolution still requires
  iterative tuning, sample-based evaluation, and human review of
  borderline matches.
- vs. Senzing / Tamr / custom blocking pipelines: AWS Entity
  Resolution is AWS-native and quick to integrate with Glue and
  Lake Formation. Specialised vendors typically lead on linkage
  quality, transitive-match handling, and the depth of identity-
  graph features.
- Pricing per matched record is competitive at modest volumes;
  at hundreds of millions of records the cost can rival running
  a dedicated Spark-based linkage job on EMR, especially when
  re-matching after data refreshes.
