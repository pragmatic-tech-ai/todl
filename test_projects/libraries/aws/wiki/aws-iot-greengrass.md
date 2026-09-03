# AWS IoT Greengrass

## Purpose

Edge runtime extending AWS to devices. Runs Lambda functions, ML inference, data sync, and inter-device communication even when the cloud link is down.

## Trade-offs

- Edge runtime ≠ cloud Lambda. Functions running on Greengrass
  have different resource ceilings, lifecycle behaviour, and
  failure modes. Code that runs on cloud Lambda often needs
  adaptation for edge.
- Device-class fit matters. Greengrass needs a real CPU and
  meaningful RAM — Raspberry-Pi-class minimum. Microcontroller
  targets need FreeRTOS or vendor-specific firmware, not
  Greengrass.
- vs. Azure IoT Edge / KubeEdge / standalone edge agents:
  Greengrass wins on tight AWS IoT Core integration; Azure IoT
  Edge has stronger module-management UX; KubeEdge fits
  Kubernetes-aware teams. Pick by deployment model and cloud
  ecosystem.
