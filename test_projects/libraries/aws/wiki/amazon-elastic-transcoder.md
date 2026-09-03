# Amazon Elastic Transcoder

## Purpose

Media transcoding from a source format into a set of device-targeted outputs (mobile, tablet, PC). Cost-effective conversion for video catalogues.

## Trade-offs

- Deprecated by MediaConvert. AWS announced no new Elastic
  Transcoder customers; MediaConvert is the forward-supported
  service for file-based transcoding with broader codec and
  format support.
- Migration to MediaConvert is straightforward but requires
  job-template recreation. Pipelines using Elastic Transcoder
  should plan the cutover rather than continue investing.
- Catalogue entry retained only for legacy reference.
