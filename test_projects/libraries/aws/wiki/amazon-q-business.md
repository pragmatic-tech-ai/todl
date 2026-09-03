# Amazon Q Business

## Purpose

Generative-AI workplace assistant grounded in enterprise data. Answers questions, summarises content, drafts text, and completes tasks tied to internal systems with permission-aware retrieval.

## Trade-offs

- Per-user pricing is steep for casual users. The flat seat
  cost makes it cost-effective for genuinely heavy use; casual
  weekly-question patterns rarely repay the per-seat fee. Audit
  intended user activity before licensing widely.
- Permission-aware retrieval is real but boundary-tight. Connectors
  inherit source-system ACLs; if SharePoint or Confluence
  permissions are messy at the source, Q Business reflects that
  mess rather than fixing it. Clean the source first.
- vs. Microsoft 365 Copilot / Glean / custom RAG on Bedrock:
  M365 Copilot wins on Microsoft-native estates; Glean leads on
  cross-SaaS reach; Bedrock-with-OpenSearch wins on
  customisability and unit economics at large scale. Q Business
  fits AWS-resident enterprise data with moderate user counts.
