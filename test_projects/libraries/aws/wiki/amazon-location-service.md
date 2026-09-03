# Amazon Location Service

## Purpose

Adds maps, tracking, and geofencing to applications without compromising user privacy. Sources mapping data from Esri and HERE through AWS-managed APIs.

## Trade-offs

- Map data quality varies by provider (Esri vs. HERE vs.
  Open Data). Coverage is uneven outside North America and
  Europe; check the actual map quality for the target market
  before committing.
- vs. Google Maps Platform / Mapbox: Google leads on map data
  freshness, search/places quality, and developer mindshare;
  Mapbox on map customisation and developer experience. Location
  Service wins on AWS-native auth, predictable pricing per call
  type, and avoiding the Google contract.
- Pricing breakdown per service (maps, places, routes,
  geofences, tracking) needs careful modelling. A naive
  estimate often misses the dominant cost — usually
  places/search at scale.
