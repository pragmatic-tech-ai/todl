# Amazon Q Developer in chat applications

## Purpose

Chat-channel interface (formerly AWS Chatbot) for monitoring and interacting with AWS from Slack, Microsoft Teams, and Amazon Chime. Receives alerts, runs commands, invokes Lambda, and opens support cases.

## Trade-offs

- Permission model maps Slack/Teams channels to IAM roles —
  powerful and easy to misconfigure. A channel granted broad
  permissions becomes a backdoor; review channel-to-role bindings
  the same way you would IAM in any other dimension.
- vs. PagerDuty / Opsgenie / Atlassian: Q in chat handles
  AWS-native notifications and read/run commands cleanly, but
  multi-cloud or rich on-call routing belongs in a dedicated
  incident-response tool that Q feeds, not replaces.
- Slack/Teams app installs and audit trails sit between the chat
  vendor and AWS. Compliance reviews need to cover both sides;
  treating it purely as an "AWS" service in audit checklists is
  a frequent gap.
