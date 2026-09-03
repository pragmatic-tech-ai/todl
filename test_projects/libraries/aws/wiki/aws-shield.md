# AWS Shield

## Purpose

DDoS protection for AWS-hosted web applications. Standard (free, baseline) and Advanced (sophisticated attacks, real-time visibility, WAF integration, DRT access).

## Trade-offs

- Standard is free and auto-applied to CloudFront and ALB —
  there's no reason to opt out. Most teams underestimate how
  much default-tier protection they already get.
- Advanced is $3,000/month per organisation, with cost-protection
  guarantees that pay back during real attacks. Justification
  hinges on whether the workload is a likely target — most
  workloads aren't, despite the marketing.
- vs. Cloudflare DDoS / Akamai Prolexic: third-party DDoS vendors
  lead on global anycast scrubbing networks and attack-response
  expertise. Shield Advanced wins on AWS-native integration and
  WAF coupling; specialists win at the very large end of the
  attack-size spectrum.
