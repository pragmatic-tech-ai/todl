# Amazon Pinpoint

## Purpose

Multi-channel outbound messaging — email, SMS, push, voice — for mobile and web apps. Captures usage data and tracks customer responses.

## Trade-offs

- AWS End User Messaging is splitting off chunks of Pinpoint's
  capability (SMS, push, voice). Greenfield projects increasingly
  use End User Messaging primitives rather than the Pinpoint
  console. Verify which side of the split the team should land
  on.
- Campaign UX is dated vs. dedicated marketing platforms. Email
  template design, A/B testing, and analytics-to-segment loops
  are minimal compared to Braze or Iterable.
- vs. Braze / Iterable / Customer.io / Twilio Engage: marketing-
  cloud vendors lead on campaign authoring, customer-data-
  platform integration, and orchestration. Pinpoint wins on
  AWS-native delivery primitives and per-message pricing for
  high-volume transactional sends.
