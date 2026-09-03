# AWS Elemental MediaStore

## Purpose

Storage layer optimised for media. Provides the consistency and low latency required for live streaming as the origin store in a video workflow.

## Trade-offs

- MediaStore is on a path to deprecation in favour of S3 +
  MediaPackage origin endpoints. AWS has been steering live-
  origin workflows toward S3 with proper cache controls.
  Greenfield work should evaluate S3 first.
- Live-origin workloads with strict ordering and read-after-
  write semantics historically needed MediaStore; S3's
  strong-after-write consistency closed much of the gap.
- Catalogue entry retained because some production workflows
  still depend on it; new architectures should validate that
  S3 + CloudFront origin shielding meets the latency and
  consistency needs before defaulting to MediaStore.
