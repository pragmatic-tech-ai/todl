# AWS IoT ExpressLink

## Purpose

Family of hardware modules from Espressif, Infineon, Realtek, and u-blox pre-provisioned with security credentials, MQTT support, Device Shadows, and OTA updates for AWS IoT.

## Trade-offs

- Hardware-vendor partnership programme, not a service per se.
  Modules from Espressif et al. cut the AWS-IoT-onboarding
  work for embedded developers — useful when picking radios
  for new product designs.
- Locks the device to AWS IoT Core. Switching to Azure IoT or
  self-hosted MQTT later requires firmware-level changes
  (sometimes module-firmware) that wouldn't exist with
  vendor-neutral firmware.
- Premium over equivalent generic modules. Justification is
  reduced engineering time and a tested security baseline; for
  large fleets a custom firmware on generic modules can
  outperform on unit cost.
