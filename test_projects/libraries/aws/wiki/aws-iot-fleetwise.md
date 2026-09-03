# AWS IoT FleetWise

## Purpose

Telemetry pipeline for vehicle data. Uses intelligent collection rules to extract relevant signals for vehicle-health analysis, ADAS, and autonomous-driving model training.

## Trade-offs

- Vertical-specific. FleetWise is purpose-built for connected
  vehicles — CAN bus signal modelling, edge collection rules,
  ADAS training pipeline. Outside automotive workloads, the
  abstractions don't transfer.
- Edge agent runs on the vehicle's existing compute (telematics
  control unit). Integration depth varies by automaker's
  vehicle architecture; production deployment is a vehicle-
  programme commitment, not a software install.
- vs. Sibros / High Mobility / Wejo / building on IoT Core:
  vertical-vehicle-data vendors lead on OEM partnerships and
  privacy-regulation expertise. FleetWise wins on AWS-native
  storage and ML-training integration.
