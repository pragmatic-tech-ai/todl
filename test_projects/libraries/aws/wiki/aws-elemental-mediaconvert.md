# AWS Elemental MediaConvert

## Purpose

File-based broadcast-grade video transcoding. Creates VOD assets for broadcast and multiscreen delivery from a single source mezzanine file.

## Trade-offs

- Per-minute transcoded pricing (with tiers for codec, resolution,
  audio passthrough vs. transcode). Large catalogue migrations
  can be expensive; reserved-tier pricing or batch optimisation
  helps.
- Job template management is its own discipline. Get the output
  group structures wrong and you re-run the job — at full
  cost. Test templates with short clips before running on
  hour-long sources.
- vs. Mux / FFmpeg-on-EC2 / Bitmovin: Bitmovin and Mux lead on
  developer experience and per-title encoding optimisation;
  raw FFmpeg is cheapest at sustained scale if the team owns
  the orchestration. MediaConvert wins on broadcast-grade
  codec support and AWS-native operations.
