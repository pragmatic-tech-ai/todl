# AWS Network Firewall

## Purpose

Managed stateful network firewall for VPCs. Adds intrusion prevention and web filtering with rule-based fine-grained traffic control.

## Trade-offs

- Hourly endpoint + per-GB processed pricing. Network Firewall
  is materially more expensive than security groups + NACLs;
  use it only when stateful inspection and intrusion-prevention
  features are actually needed.
- Suricata rule syntax is powerful but requires expertise to
  tune. Out-of-the-box managed rule groups catch broad cases;
  custom rules are where production tuning lives.
- vs. third-party NGFW on EC2 (Palo Alto, Check Point) /
  GWLB-fronted appliances: third-party vendors lead on
  enterprise firewall features (decryption, threat intel
  integrations, GUI policy management). Network Firewall wins
  on AWS-native operations and IAM integration.
