# Amazon Interactive Video Service

## Purpose

Managed live-streaming pipeline. Takes RTMP ingest from streaming software and delivers low-latency live video worldwide for interactive experiences.

## Trade-offs

- Built on Twitch's tech and tuned for the interactive-live use
  case (low-latency video + chat). Wrong tool for VOD-first
  workflows or broadcast-style high-bitrate streams; right for
  social live, e-commerce live, and creator broadcasts.
- vs. Mux / Cloudflare Stream / Vimeo / building on MediaLive +
  MediaPackage + CloudFront: Mux leads on developer experience
  and API ergonomics, Cloudflare Stream on bundled-CDN
  economics. IVS wins on integrated chat and low-latency
  defaults.
- Per-hour ingest + per-GB delivery pricing. Long streams to
  large audiences add up; model the streamer × audience-hours
  × bitrate matrix before committing.
