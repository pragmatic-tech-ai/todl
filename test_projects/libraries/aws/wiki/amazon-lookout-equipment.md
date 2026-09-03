# Amazon Lookout for Equipment

## Purpose

ML-based anomaly detection over industrial sensor data (pressure, flow rate, RPM). Trains a custom model per machine without requiring ML expertise to spot early failure signs.

## Trade-offs

- Service end-of-life is scheduled. AWS announced no new
  customers and a sunset timeline for Lookout for Equipment;
  workloads need a migration plan to SiteWise + custom SageMaker
  models or a third-party industrial AI platform.
- Requires meaningful sensor history. The marketing line "no ML
  expertise needed" obscures the data prerequisite — months of
  clean multi-sensor data per machine with labelled or
  pseudo-labelled failure windows is non-trivial to collect.
- vs. Monitron / SageMaker / SparkCognition / Augury: Monitron is
  a hardware-+-cloud package for narrow vibration use cases;
  Lookout was the BYO-sensor flexible tier. Migration target is
  workload-shape-dependent, not service-substitute-dependent.
