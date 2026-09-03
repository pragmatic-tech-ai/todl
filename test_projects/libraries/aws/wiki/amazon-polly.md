# Amazon Polly

## Purpose

Managed text-to-speech with standard, neural, newscaster, and brand-voice modes across dozens of languages. Synthesises lifelike audio for accessibility, IVR, and content production.

## Trade-offs

- Voice quality has stratified. Standard voices sound dated;
  Neural and Generative voices are far better but cost
  meaningfully more per character. Mixing tiers across an
  application by use-case is the usual cost-quality compromise.
- vs. ElevenLabs / Azure Neural / Google Neural2: ElevenLabs leads
  on expressive long-form generation and voice cloning; Azure and
  Google lead on certain languages. Polly leads on AWS-native
  integration (Connect, S3, Lambda) and IVR-grade reliability.
- Brand-voice custom model is gated, expensive, and slow to
  produce. Most "custom voice" needs are now served better by
  ElevenLabs or Microsoft's neural-voice program; reach for
  Brand Voice only when AWS-native operation is a hard
  requirement.
