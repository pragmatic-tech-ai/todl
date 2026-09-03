# AWS IoT Device Management

## Purpose

Lifecycle management for IoT devices at scale. Bulk registration, organisation, monitoring, and OTA firmware updates across heterogeneous device types and operating systems.

## Trade-offs

- OTA updates are the headline feature. Designing the OTA
  rollout strategy (canaries, A/B-by-device-group, rollback)
  is real engineering work; Device Management provides the
  primitives, not the strategy.
- Fleet provisioning (just-in-time provisioning, claim
  certificates, bulk provisioning) is more bespoke than the
  marketing suggests. Each provisioning model has its own
  trade-offs for security and operational complexity.
- vs. Azure IoT Hub Device Twin / Particle Device Cloud:
  competing IoT-management platforms have similar capabilities;
  pick by which IoT broker the fleet talks to and which
  ecosystem the team standardises on.
