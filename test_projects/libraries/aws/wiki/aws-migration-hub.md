# AWS Migration Hub

## Purpose

Unified migration dashboard. Tracks application migration progress across multiple AWS and partner tools so program managers see portfolio status in one place.

## Trade-offs

- Aggregator dashboard, not a migration engine. The real work
  is done by Application Discovery, Application Migration,
  DMS, and so on; Migration Hub provides the program-level
  visibility on top.
- Useful exactly during a migration programme. Once migrations
  finish, value drops. Not a long-running operational tool.
- vs. third-party migration tracking (Smartsheet, Asana, Jira):
  Migration Hub knows the AWS-tool execution state natively;
  general project tools require manual status updates. Pair
  them — Migration Hub for tool execution, project tools for
  stakeholder communication.
