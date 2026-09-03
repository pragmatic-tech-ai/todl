# Amazon AppFlow

## Purpose

Managed point-to-point integration service moving data between SaaS apps (Salesforce, Zendesk, Slack, ServiceNow) and AWS services (S3, Redshift). Scheduled, event-driven, or on-demand flows with filtering and PrivateLink.

## Trade-offs

- Connector catalogue is finite. Source/target combinations outside
  the managed list fall back to Lambda + SDK — exactly the plumbing
  AppFlow was meant to remove. Verify catalogue coverage before
  betting an integration on it.
- Pricing per flow execution + per record. Frequent or streaming
  flows over large SaaS objects (Salesforce account histories,
  Zendesk ticket exports) get expensive fast; an hourly batch is
  often cheaper than near-real-time.
- vs. Glue / Lambda+SDK: AppFlow wins on "SaaS → S3, almost no
  transformation". Once joins, lookups, or dedup enter the picture,
  fighting AppFlow's UI ends up longer than the equivalent Glue or
  Lambda job.
