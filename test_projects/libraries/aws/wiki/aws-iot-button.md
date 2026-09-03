# AWS IoT Button

## Purpose

Programmable Wi-Fi button based on Amazon Dash Button hardware. Used for getting started with AWS IoT Core, Lambda, DynamoDB, and SNS without writing device-specific code.

## Trade-offs

- End-of-life. AWS discontinued IoT Button sales; the existing
  buttons still trigger AWS IoT Core events but no replacement
  is shipping. Treat as a curiosity, not infrastructure.
- Was always a learning tool, never a production input.
  Greenfield "press button to trigger" workflows belong on
  off-the-shelf IoT devices (M5Stack, Particle, ESP32) speaking
  MQTT to IoT Core.
- Catalogue entry retained because some training material still
  references it.
