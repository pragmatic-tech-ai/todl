# Amazon Monitron

## Purpose

End-to-end industrial-IoT system — sensors, gateway, managed service, and mobile app — that detects abnormal machine behaviour for predictive maintenance.

## Trade-offs

- Closed hardware stack. AWS supplies the sensors and gateway;
  you cannot bring your own. That simplifies deployment but locks
  the program to AWS's hardware roadmap and refresh cadence.
- Vibration + temperature only. No flow, pressure, current,
  acoustic, or other modalities the way a full SiteWise or
  third-party Industrial AI platform supports. Pick Monitron
  only when the failure modes show up in vibration signatures.
- vs. SparkCognition / Augury / Senseye / Uptake: incumbent
  Industrial AI vendors bring decades of failure-mode libraries
  and reliability-engineering consulting Monitron does not.
  Monitron wins on speed-to-first-alert and AWS-billed simplicity;
  incumbents win on rotating-equipment depth.
