# Amazon SES

## Purpose

Simple Email Service — bulk and transactional email send. Flexible IP deployment, authentication options, and pay-per-send billing for application-driven mail.

## Trade-offs

- Sandbox-by-default. New SES accounts can only send to verified
  addresses until production-access approval — a deliberate
  anti-spam guard that surprises teams expecting to send the
  day they enable the service.
- Deliverability is the customer's responsibility. SES is the
  send pipe; SPF, DKIM, DMARC, bounce/complaint handling, list
  hygiene, and IP warm-up all sit with you. Without that
  discipline, deliverability tanks.
- vs. SendGrid / Mailgun / Postmark / Amazon Pinpoint: dedicated
  email vendors lead on deliverability monitoring, IP warm-up
  automation, and transactional-email features. SES wins
  decisively on per-thousand-email cost for high volume —
  often 5-10x cheaper at scale.
