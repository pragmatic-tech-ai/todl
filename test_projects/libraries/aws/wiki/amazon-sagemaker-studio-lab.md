# Amazon SageMaker AI Studio Lab

## Purpose

Free, no-AWS-account ML sandbox preloaded with common notebooks and frameworks. Targeted at students, hobbyists, and people learning ML on the SageMaker surface.

## Trade-offs

- Free, but capped. Limited CPU/GPU runtime per day, no
  guaranteed availability, no persistent always-on environment.
  Useful for learning; not useful as a workhorse.
- No path to production. A notebook prototyped here doesn't move
  to a SageMaker account without re-uploading code, replumbing
  IAM, and re-attaching datasets. Treat outputs as throwaway.
- vs. Google Colab / Kaggle Kernels: Colab dominates ML
  education in the broader ecosystem, with better notebook
  sharing and a more generous free tier. Studio Lab's edge is
  exposure to SageMaker idioms specifically.
