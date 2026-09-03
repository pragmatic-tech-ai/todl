# Amazon Forecast

## Purpose

Managed time-series forecasting service. Combines time-series with related variables to produce forecasts more accurate than purely-univariate baselines.

## Trade-offs

- New customer onboarding is closing — AWS has steered new
  forecasting work to SageMaker Canvas and Bedrock for time-
  series capability. Greenfield Forecast work is no longer the
  recommended path.
- vs. Prophet / GluonTS / SageMaker DeepAR: Forecast wraps the
  underlying algorithms (DeepAR+, NPTS, ETS, ARIMA, Prophet) with
  AutoML hyperparameter selection. Teams with forecasting
  expertise often get better results with direct algorithm
  control on SageMaker; teams without expertise occasionally do
  worse because they don't know which algorithm Forecast picked.
- Data preparation is the real work, the service is the small
  part. Hierarchical aggregation, related-time-series cleanliness,
  and item-metadata quality matter more than the algorithm
  choice — and Forecast does not solve those for you.
