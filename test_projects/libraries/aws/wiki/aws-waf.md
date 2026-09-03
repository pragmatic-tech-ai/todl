# AWS WAF

## Purpose

Web application firewall protecting CloudFront, API Gateway, ALB, and AppSync endpoints from common web exploits and bots. Managed Rules ship with curated protection patterns.

## Trade-offs

- Managed rule groups are the right starting point but each one
  carries a separate per-request charge. Stacking many groups
  without thought multiplies the cost; review which rule groups
  the actual workload needs before enabling all of them.
- Custom rules require expertise to author safely. WAF rule
  evaluation order, scope-down statements, and rate-based rules
  interact in non-obvious ways; aggressive rules block real
  traffic, lenient rules let attacks through. Plan for tuning
  cycles in the first weeks.
- vs. Cloudflare WAF / Akamai App & API Protector / Imperva:
  third-party WAFs lead on detection sophistication, managed
  rule freshness, and bot management. AWS WAF wins on
  AWS-native integration with CloudFront, ALB, and API Gateway.
