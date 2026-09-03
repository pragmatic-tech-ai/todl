# AWS IoT Device Defender

## Purpose

Security-posture monitor for IoT fleets. Audits IoT configurations against best practices and sends alerts on suspicious device behaviour.

## Trade-offs

- Behavioural anomaly detection is on by default and useful;
  custom-metric rules require operators who understand the
  fleet's normal traffic shape. Without that, false-positive
  rate is high.
- Audit checks are good baselines (overly-permissive policies,
  certificate sharing) but not exhaustive. Treat as a hygiene
  layer; full IoT security requires Inspector + GuardDuty +
  Macie + Device Defender in concert.
- Per-device-per-month pricing scales with fleet size. Large
  fleets see meaningful cost; sampling-based audits help when
  individual-device cost matters.
