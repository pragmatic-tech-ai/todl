# AWS User Notifications

## Purpose

Central hub for AWS service notifications — Health events, CloudWatch alarms, EC2 state changes — delivered via Console, email, chat, push, or API in a normalised format.

## Trade-offs

- Newer service trying to unify the scattered notification
  story across AWS. Useful but not yet broad enough to retire
  EventBridge → SNS → Lambda → chat-tool patterns. Treat as
  complementary, not replacement.
- Aggregation works best for engineer-facing notifications.
  Customer-facing notifications, transactional emails, or
  delivery-receipt patterns belong on SNS, SES, or Pinpoint.
- vs. PagerDuty / Opsgenie integrations: User Notifications
  delivers AWS events to engineers; serious on-call routing,
  escalation policies, and incident management still live in
  the dedicated tools.
