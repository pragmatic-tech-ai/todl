# Amazon Verified Permissions

## Purpose

Externalised authorization service for custom applications. Uses the Cedar policy language and SDK to manage fine-grained permissions centrally.

## Trade-offs

- Cedar is a new policy language with a real learning curve.
  Teams that already model authorization in OPA/Rego have to
  decide whether the migration is worth Cedar's particular
  shape (relation-based, statically analyzable).
- Latency tax on per-request authorization. Network round-trips
  to AVP add tens of milliseconds; hot paths often need a local
  policy cache. The architecture pattern is more involved than
  the marketing implies.
- vs. OPA / Oso / SpiceDB / building it yourself: SpiceDB leads
  on relation-based fine-grained AuthZ at scale; OPA leads on
  language and ecosystem maturity. AVP wins when AWS-native
  hosting, Cedar's analysis properties, or tight Cognito
  integration is the priority.
