# AWS IoT Core

## Purpose

Cloud broker for connected devices. Supports billions of devices and trillions of messages, routing them between devices and AWS endpoints reliably and securely.

## Trade-offs

- Per-million-messages plus per-million-rules-engine-executions
  pricing. Chatty fleets and broad rule fan-out compound the
  bill; designs that batch messages or filter at the device
  reduce cost meaningfully.
- Device authentication is X.509-cert-based by default with TLS
  mutual auth. Certificate provisioning and rotation are
  ongoing operations problems — claim certificates, just-in-
  time provisioning, and CSR workflows all need design before
  scale.
- vs. Azure IoT Hub / Google Cloud IoT (retired) / EMQX /
  HiveMQ / Mosquitto self-hosted: AWS IoT Core wins on
  AWS-ecosystem integration (Greengrass, Lambda, Kinesis,
  S3 rule actions). Azure IoT Hub leads on Microsoft-stack
  integration; self-hosted MQTT brokers win at very large
  scale where the AWS per-message cost dominates.
