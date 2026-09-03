# Amazon Chime SDK

## Purpose

SDK embedding real-time voice, video, and messaging into custom applications. ML-powered features for noise suppression and quality monitoring.

## Trade-offs

- vs. Twilio Video / Daily / Agora / Vonage: dedicated CPaaS
  vendors lead on SDK polish, integration breadth, and global
  network optimisation. Chime SDK is competitive in feature set
  and wins on AWS-native billing and account-level IAM.
- Per-attendee-minute and per-feature pricing is granular.
  Noise suppression, transcription, and other ML features bill
  separately — turning them all on without thought multiplies
  the bill. Pick by genuine product need.
- SIP and PSTN connectivity is available but operationally
  involved. Telecom routing, regulatory compliance per country,
  and SIP trunk pricing all need attention beyond the SDK
  itself.
