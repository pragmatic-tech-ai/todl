# AWS Verified Access

## Purpose

Zero-trust application gateway providing VPN-less access to private corporate applications. Evaluates each request against identity and device-posture signals in real time.

## Trade-offs

- HTTP/HTTPS only. Non-web protocols (SSH, RDP, database wire
  protocols, file shares) still need Session Manager, traditional
  VPN, or a third-party ZTNA — AVA does not replace the full VPN
  surface area.
- Authentication is delegated to IAM Identity Center or an external
  OIDC IdP. AVA inherits the IdP's availability and policy quirks;
  a misconfigured IdP locks users out of everything fronted by
  AVA simultaneously.
- vs. Cloudflare Access / Zscaler ZPA: AVA integrates natively with
  ALB/NLB and AWS WAF but lags on device-posture telemetry, agent
  fleet coverage, and SaaS application catalogues. AWS-only
  application estates fit AVA; mixed-cloud or heavy-SaaS estates
  often don't.
