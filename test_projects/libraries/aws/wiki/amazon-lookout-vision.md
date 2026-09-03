# Amazon Lookout for Vision

## Purpose

ML service spotting defects and anomalies in product images. Manufacturers identify quality issues from photos at scale without writing custom computer-vision pipelines.

## Trade-offs

- Like the other Lookout services, this one is on a deprecation
  path. AWS is steering new visual-inspection work to Rekognition
  Custom Labels or SageMaker; greenfield Lookout for Vision is
  not the right choice.
- Defect-detection quality is heavily dataset-dependent. The
  service claims "30 normal images per workflow" but production
  deployments routinely need thousands of labelled defect
  examples to hit acceptable false-negative rates.
- Edge inference is a separate path (via Panorama or Greengrass).
  Cloud-only inference adds round-trip latency that production
  lines may not tolerate; plan the edge story before committing
  to the service.
