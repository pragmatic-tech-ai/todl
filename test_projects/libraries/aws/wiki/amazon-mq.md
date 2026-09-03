# Amazon MQ

## Purpose

Managed message broker service for Apache ActiveMQ Classic and RabbitMQ. Supports industry-standard messaging protocols including JMS, NMS, AMQP, STOMP, MQTT, and WebSocket.

## Trade-offs

- ActiveMQ Classic is on a long-tail upstream path; new work should
  pick RabbitMQ when the protocol allows. Otherwise the choice
  locks the workload to an engine the upstream community is
  gradually moving past.
- Vertical scaling only — throughput climbs by broker resize, not
  by partitioning. Amazon MQ exists for protocol compatibility
  (JMS, AMQP, STOMP, MQTT-over-WebSocket), not for the kind of
  raw throughput that SQS or MSK reach.
- vs. SQS / SNS / MSK: if no specific feature (transactions, JMS
  message selectors, AMQP exchanges, STOMP clients) is forcing
  the choice, AWS-native messaging is cheaper, simpler, and
  multi-AZ without effort.
