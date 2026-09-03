# Amazon Panorama

## Purpose

Computer-vision SDK plus appliance bringing CV to existing IP cameras at the edge. Inspects video feeds on-premises for use cases with bandwidth limits or data-residency requirements.

## Trade-offs

- Hardware appliance is a hard commitment. Sites need the actual
  Panorama device — power, network, mounting — and the appliance
  pricing dominates small-scale pilots.
- Service has effectively stopped receiving new investment. AWS
  has steered new edge-CV workloads to Greengrass + custom
  SageMaker models or Rekognition + IoT-side bridges. Greenfield
  Panorama work is not the recommended path.
- vs. Greengrass + SageMaker Neo: more flexible but more
  integration work. Pick Panorama only when its narrow appliance-
  shaped deployment model genuinely matches the site, and the
  road-map risk is acceptable.
