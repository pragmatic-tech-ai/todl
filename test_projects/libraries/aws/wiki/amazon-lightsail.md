# Amazon Lightsail

## Purpose

Bundled VPS offering — VM, SSD storage, data transfer, DNS, and static IP at a low predictable monthly price. Targeted at small projects that don't need EC2 levels of configurability.

## Trade-offs

- Crossing into EC2 from Lightsail is a re-platform, not a
  resize. Lightsail's account model, networking, and snapshot
  formats don't map 1:1 to EC2; growing workloads pay a real
  migration cost.
- vs. DigitalOcean / Linode / Hetzner: similar VPS bundling
  with often better unit economics at the small end. Lightsail
  wins when "stay in AWS for IAM / VPC / data-residency"
  matters; otherwise the alternatives are competitive and
  occasionally cheaper.
- Use Lightsail for genuine small-fixed projects: a marketing
  site, a side project, an SMB app server. Production work
  that grows belongs on EC2 / Fargate / Lambda from day one.
