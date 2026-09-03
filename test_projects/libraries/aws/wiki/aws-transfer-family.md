# AWS Transfer Family

## Purpose

Managed SFTP, FTPS, and FTP endpoints in front of S3 and EFS. Integrates with existing authentication systems and Route 53 DNS for transparent partner cutover.

## Trade-offs

- Hourly per-endpoint pricing plus per-GB transferred. Low-
  traffic SFTP endpoints pay a fixed monthly floor; legacy
  partner integrations that send a few files per day pay more
  than they would on a small EC2 instance running OpenSSH.
- Useful exactly because trading partners still demand SFTP/
  FTPS. Replacing SFTP in B2B workflows is harder than
  replacing the SFTP server; Transfer Family lets you upgrade
  the underlying storage without breaking partners.
- AS2 support added later as a separate feature. EDI-style
  workflows now have SFTP + AS2 in one service — but real B2B
  data interchange may need [`aws-b2b-data-interchange`](aws-b2b-data-interchange.md)
  for the transformation layer.
