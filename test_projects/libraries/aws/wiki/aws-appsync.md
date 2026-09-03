# AWS AppSync

## Purpose

Managed GraphQL backend for mobile, web, and enterprise applications. Lets clients describe their exact data needs in a single declarative query.

## Trade-offs

- VTL resolvers (mapping templates) are the historic AppSync
  pain point. JavaScript resolvers improved this but still
  carry quirks — debugging a misbehaving resolver is harder
  than debugging a Lambda function. Subscription delivery has
  edge cases that bite at scale.
- Real-time subscriptions are the differentiator vs. roll-your-
  own GraphQL. Without that need, a Lambda + API Gateway +
  Apollo Server combination is often more flexible at similar
  cost.
- vs. Hasura / Apollo Server / GraphQL Yoga / Postgraphile:
  open-source GraphQL stacks lead on developer experience and
  flexibility; Hasura on Postgres-introspection productivity.
  AppSync wins on AWS-native scaling and IAM integration when
  the backend is DynamoDB, RDS, or Lambda.
