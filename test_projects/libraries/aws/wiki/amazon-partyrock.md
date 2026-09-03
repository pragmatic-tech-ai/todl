# Amazon PartyRock

## Purpose

Code-free GenAI app builder backed by Bedrock foundation models. Designed as a hands-on learning environment for prompt engineering and rapid experimentation.

## Trade-offs

- Learning sandbox, not a production runtime. PartyRock has no
  SLA, no auth/permissions model fit for enterprise data, and
  no path to package an app for embedding. Production GenAI work
  starts on Bedrock directly.
- Useful exactly because it is throwaway. Prompt-engineering
  experiments, intern projects, and lunch-and-learn demos cost
  nothing to spin up; treat it as a Figma for prompt design,
  not as software supply.
- No portable export. A working PartyRock prototype does not
  convert to a Bedrock-driven application — the team has to
  re-implement the prompt graph using SDKs. Plan for the
  rewrite if the prototype proves out.
