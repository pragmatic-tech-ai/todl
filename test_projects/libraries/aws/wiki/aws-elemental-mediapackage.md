# AWS Elemental MediaPackage

## Purpose

Packaging and protection for video delivery. Produces device-specific renditions, DVR features, and applies DRM to safeguard content rights.

## Trade-offs

- DRM is the differentiator — Widevine, FairPlay, PlayReady
  integration via SPEKE. Without DRM requirements, packaging
  can be done in MediaConvert outputs or by direct manifest
  generation. MediaPackage's value is the protected-content
  path.
- Per-input-GB pricing scales with the encoded bitrate, not the
  delivered bitrate. High-bitrate UHD live streams cost more
  to package than the delivery would suggest.
- vs. self-managed packaging (Shaka Packager / Bento4): manual
  packaging is cheaper at sustained scale but requires
  pipeline engineering. MediaPackage wins on AWS-native
  integration and one-click DRM provisioning.
