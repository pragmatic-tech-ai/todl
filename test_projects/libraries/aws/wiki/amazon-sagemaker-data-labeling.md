# Amazon SageMaker AI Data Labeling

## Purpose

Labelling pipeline inside SageMaker that turns raw images, text, and video into annotated training datasets. Mediates between human reviewers and ML-assisted pre-labelling.

## Trade-offs

- The workflow is good; the workforce is the real cost. Ground
  Truth (the underlying service) supplies built-in private,
  vendor, and Mechanical Turk workforces; choice of workforce
  drives turnaround time, cost, and quality more than any
  feature toggle.
- ML-assisted pre-labelling needs a seed model. The auto-labelling
  feature only kicks in past a few thousand human-labelled
  examples; it does not solve the cold-start labelling problem
  smaller projects often have.
- vs. Scale AI / Labelbox / SuperAnnotate: specialised labelling
  vendors lead on tooling depth (3D point clouds, video, expert
  workforces). Ground Truth wins on AWS-native integration with
  the rest of SageMaker.
