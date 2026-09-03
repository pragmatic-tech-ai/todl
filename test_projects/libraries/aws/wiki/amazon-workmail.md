# Amazon WorkMail

## Purpose

Managed business email and calendar service. Compatible with Outlook, iOS/Android native mail, IMAP clients, and the web; interoperates with Exchange Server.

## Trade-offs

- Niche audience. Most organisations already on Microsoft 365
  or Google Workspace get email plus the productivity suite at
  near-zero marginal cost vs. paying for WorkMail separately.
  WorkMail's case is narrow: regulated estates needing AWS-region
  data residency for mail specifically.
- Feature gap vs. Exchange Online. Calendar, mail rules,
  delegated mailbox, and integration features are present but
  thinner than the Microsoft equivalent. Power users feel the
  gap quickly.
- vs. Microsoft 365 / Google Workspace / Proton Business: SaaS
  email leaders win on every dimension except AWS-resident
  data and AWS-IAM integration. WorkMail only justifies itself
  in regulated AWS-heavy estates.
