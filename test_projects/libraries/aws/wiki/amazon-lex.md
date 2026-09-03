# Amazon Lex

## Purpose

Managed conversational-interface builder. Provides ASR and NLU built on the same technology behind Alexa, with voice and text deployment into custom applications.

## Trade-offs

- Intent/slot bot-builder model predates current LLM patterns and
  feels increasingly dated. Designing a Lex bot is a Carnival
  of forms; an LLM-prompted equivalent via Bedrock is often
  shorter to ship and more flexible for free-form input.
- Strongest case is Connect integration. As the IVR/voicebot for
  Amazon Connect, Lex remains the path of least resistance — the
  ASR, telephony, and turn-taking are pre-integrated. Outside
  Connect, the trade-off shifts toward LLM stacks.
- vs. Dialogflow / Watson Assistant / Rasa: feature-equivalent at
  the classical-NLU level; differentiation is AWS-ecosystem
  integration (Lambda fulfilment, IAM, CloudWatch). Pick by where
  the rest of the stack lives.
