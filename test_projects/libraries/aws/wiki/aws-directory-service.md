# AWS Directory Service

## Purpose

Managed Microsoft Active Directory in AWS. Provides Group Policy, SSO, and domain join for directory-aware workloads without standing up domain controllers.

## Trade-offs

- Three flavours, three pricing tiers. AWS Managed Microsoft AD
  is the real domain controller; AD Connector is a proxy to
  on-prem AD; Simple AD is Samba 4. The names confuse — pick
  by the actual feature need, not the brand intuition.
- Required for many Microsoft-ecosystem services (FSx for
  Windows, RDS for SQL Server in some modes, EC2 fleet domain-
  join). Once a directory is in place, services anchor to it
  and detaching is operationally expensive.
- vs. self-managed AD on EC2 / Entra ID + Microsoft Entra
  Domain Services: AWS Managed AD is the path of least
  resistance for AWS-resident Windows workloads. Entra Domain
  Services is the equivalent for Azure-resident workloads.
  Mixing is technically possible but operationally painful.
