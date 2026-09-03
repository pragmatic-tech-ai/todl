# AWS Elemental MediaConnect

## Purpose

High-quality live-video transport. Combines satellite-grade reliability with IP-network economics for broadcast-grade contribution feeds.

## Trade-offs

- Broadcast-grade transport (SRT, Zixi, RIST, RTP) is the value
  proposition. For consumer-grade RTMP / WebRTC ingest, IVS or
  MediaLive are simpler and cheaper. MediaConnect lives in the
  contribution path before MediaLive.
- Per-output and per-flow-minute pricing; transit between flows
  bills too. Multi-output multi-region distribution can produce
  surprising bills. Architect for minimum required outputs.
- vs. Zixi cloud / Haivision SRT Hub / NDI workflows: dedicated
  contribution vendors lead on protocol depth and broadcast-
  engineering features. MediaConnect wins on AWS-native
  integration with MediaLive / MediaPackage and consolidated
  billing.
