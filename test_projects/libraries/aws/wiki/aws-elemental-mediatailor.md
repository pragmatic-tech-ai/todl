# AWS Elemental MediaTailor

## Purpose

Personalised ad insertion into video streams. Combines content and targeted ads with broadcast-grade quality of service and automated reporting.

## Trade-offs

- Server-side ad insertion is the differentiator. Client-side
  ad blockers do not affect SSAI streams — that's the entire
  business case. If ad blocking isn't a concern, simpler
  client-side insertion fits.
- Requires a VAST/VMAP-compliant ad decision server. MediaTailor
  is the stitcher; it does not provide ad targeting or
  inventory. Pair with FreeWheel, GAM, or SpotX.
- vs. Brightcove SSAI / Yospace / SpringServe: dedicated SSAI
  vendors lead on agency-integration features, beacon support
  variety, and creative-decisioning depth. MediaTailor wins on
  AWS-native pricing and tight integration with MediaPackage.
