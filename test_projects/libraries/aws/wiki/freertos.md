# FreeRTOS

## Purpose

AWS-supported microcontroller OS. Extends the FreeRTOS kernel with libraries for secure connection to AWS IoT Core or IoT Greengrass.

## Trade-offs

- AWS distribution of an open-source kernel with AWS-IoT
  libraries. The kernel itself is the broad-ecosystem choice;
  picking the AWS distribution mainly buys the pre-integrated
  IoT-side networking libraries.
- vs. Zephyr / Mbed OS / vendor RTOS: Zephyr has stronger
  recent community momentum; vendor RTOSes (ChibiOS, ThreadX,
  vendor-specific) win on tight hardware integration. FreeRTOS
  with AWS bindings wins when AWS IoT Core is the target and
  cycle-time-to-onboarding matters.
- Production fleets typically build a custom firmware on top
  of FreeRTOS, not deploy the stock distribution. Treat the
  AWS bundle as a reference implementation, not a finished
  product firmware.
