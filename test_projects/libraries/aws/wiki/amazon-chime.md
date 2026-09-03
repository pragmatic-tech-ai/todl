# Amazon Chime

## Purpose

Online-meetings, video conferencing, chat, and content sharing across devices. Integrates with Alexa for Business for voice-activated meeting start.

## Trade-offs

- Effectively retired for end-user meetings. AWS discontinued
  the Chime client; the brand survives mainly as Chime SDK.
  Greenfield collaboration work should target Teams, Zoom,
  Google Meet, or Slack Huddles — not Chime.
- The Voice Connector and meeting features moved to Chime SDK
  and AWS End User Messaging. Customers running Chime today
  should be on a migration path, not a feature-adoption path.
- Catalogue entry retained for legacy reference. Any architecture
  diagram still showing Chime is a sign of staleness.
