# Amazon Textract

## Purpose

Document-intelligence service extracting text, key-value pairs, and tables from scanned documents. Pre-trained Queries handle paystubs, bank statements, W-2s, loan applications, and insurance cards.

## Trade-offs

- Quality on clean, form-shaped documents is strong; on
  handwritten, rotated, low-DPI, or unusual layout documents
  it degrades sharply. Most production pipelines bolt a
  validation / human-review layer on top — Textract isn't a
  drop-in OCR replacement.
- Per-page pricing across multiple features (forms, tables,
  queries, signatures, layout) multiplies. High-volume document
  pipelines need careful feature selection — turning on every
  extraction type "to be safe" inflates the bill linearly.
- vs. Google Document AI / Azure Document Intelligence /
  open-source (Tesseract + LayoutLMv3): Textract leads on
  AWS-native integration and Queries feature; Document AI
  leads on custom-extractor workflow polish; Azure on Office-
  embedded scenarios. Pick by ecosystem and per-page economics.
