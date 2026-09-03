# AWS Partner Device Catalog

## Purpose

Catalog of partner-built IoT hardware verified to work with AWS — dev kits, embedded systems, gateways, edge servers, sensors, cameras — for IoT solution builders.

## Trade-offs

- Listing service, not a runtime. The "service" is a directory
  of partner hardware that has been certified for AWS IoT.
  Architectural diagrams should reference the actual partner
  device, not this catalogue entry.
- Verification depth varies. "Works with AWS IoT" can mean
  anything from "passes a basic MQTT test" to "full Greengrass
  + OTA support". Drill into the per-device qualification
  details before committing.
- Use as a starting point for hardware selection in greenfield
  IoT programmes. Mature programmes typically negotiate
  directly with module vendors rather than picking from the
  catalogue.
