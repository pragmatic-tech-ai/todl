# AWS Backup

## Purpose

Centralised backup orchestration across EC2, EBS, RDS, DynamoDB, EFS, FSx, and Storage Gateway. Policy-based, cost-effective, and managed via a single console.

## Trade-offs

- Restore is what matters, and AWS Backup's restore UX is uneven
  across resource types. Test the actual restore path for each
  protected resource — discovering RDS cross-region restore
  quirks or EFS partial-restore behaviour during a real incident
  is the wrong time.
- Backup vault lock and compliance modes are powerful (immutable
  retention for ransomware protection) and irreversible. Set
  vault locks deliberately; "tightened" defaults end up
  preventing legitimate retention reductions later.
- vs. Veeam / Commvault / Druva: third-party backup vendors lead
  on cross-cloud reach, application-aware backup (Exchange, SAP),
  and more sophisticated retention policies. AWS Backup wins on
  AWS-native simplicity and consolidated billing.
