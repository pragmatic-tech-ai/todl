# Amazon Transcribe

## Purpose

Managed automatic speech recognition. Converts speech to text across a wide range of speakers and acoustic environments. Specialised siblings include Transcribe Medical and Transcribe Call Analytics.

## Trade-offs

- vs. OpenAI Whisper / Deepgram / Google Speech-to-Text: Whisper
  (especially via OpenAI or self-hosted) is the current quality
  reference for accented English and multi-lingual transcription;
  Deepgram leads on real-time streaming accuracy. Transcribe is
  competitive in many tasks but rarely the quality leader.
- Custom-vocabulary support handles domain terms but doesn't
  fix systematic accent or noise issues. For specialist
  domains (medical, legal, call-centre), the specialised
  Transcribe variants are usually a better starting point than
  the base service plus custom vocabulary.
- Streaming pricing is per-second; batch is per-second too but
  cheaper. High-volume offline corpora benefit from chunking and
  parallel batch jobs; not from streaming endpoints. Use the
  right mode for the workload shape.
