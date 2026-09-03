# AWS Elemental MediaLive

## Purpose

Broadcast-grade real-time video encoder. Produces high-quality live streams for delivery to connected TVs, mobiles, computers, tablets, and game consoles.

## Trade-offs

- Per-channel-hour pricing on configured channel class (SD / HD
  / UHD). Idle channels still bill; start/stop discipline is
  load-bearing for cost. 24/7 production channels stay running
  by design.
- Channel-class downgrades are not a simple edit; restructuring
  involves recreating channels. Get the channel class right
  before going to air.
- vs. IVS / direct OBS-to-CloudFront flows: IVS is simpler for
  interactive social-live and bundles ingest+delivery; MediaLive
  is the right answer when broadcast-grade live encoding,
  multiple ABR ladders, ad insertion, or specific codec
  configurations are required.
