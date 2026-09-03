# Amazon Kinesis Video Streams

## Purpose

Secure ingest pipeline for video from connected devices. Streams to AWS for analytics, ML, and playback, integrated with Rekognition Video and ML frameworks.

## Trade-offs

- Storage and ingest pricing accrues per stream-hour and per GB.
  Long-retention fleets of cameras can outpace the analytics
  value delivered — a tiering plan into S3 or expiry rules is
  load-bearing for unit economics.
- WebRTC support is narrower than the marketing implies: signalling
  channels are managed, but client integration still requires the
  KVS WebRTC SDK and TURN configuration. Treat as a building
  block, not a turnkey real-time platform.
- Rekognition Video integration is the differentiator vs.
  generic-cloud video ingest. If the downstream isn't AWS-native
  ML / playback, the cost gap vs. self-managed RTMP/HLS ingest
  is harder to justify.
