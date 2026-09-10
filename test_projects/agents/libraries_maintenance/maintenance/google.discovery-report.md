---
library: google
vendor: "Google Cloud"
crawl-date: 2026-05-12
seeds:
  - https://cloud.google.com/products
  - https://cloud.google.com/docs
  - https://workspace.google.com/products/
  - https://ai.google.dev/
  - https://firebase.google.com/products
total-technologies: 183
---

## Locations

```yaml
observed:
  - vendor-label: "Google Cloud (Commercial)"
    occurrences: 150
    sources:
      - https://cloud.google.com/products
      - https://cloud.google.com/docs/product-list
  - vendor-label: "Google Distributed Cloud"
    occurrences: 8
    sources:
      - https://cloud.google.com/blog/products/compute/cross-cloud-infrastructure-at-next26
      - https://cloud.google.com/solutions/ai-hypercomputer
  - vendor-label: "Google Sovereign Cloud"
    occurrences: 4
    sources:
      - https://cloud.google.com/security/products/assured-workloads
      - https://cloud.google.com/blog/products/compute/cross-cloud-infrastructure-at-next26
  - vendor-label: "FedRAMP High"
    occurrences: 3
    sources:
      - https://cloud.google.com/blog/products/data-analytics/whats-new-with-google-data-cloud
      - https://cloud.google.com/security/products/assured-workloads
  - vendor-label: "Google Workspace"
    occurrences: 20
    sources:
      - https://workspace.google.com/products/
      - https://en.wikipedia.org/wiki/Google_Workspace
  - vendor-label: "Firebase"
    occurrences: 18
    sources:
      - https://firebase.google.com/products-build
      - https://en.wikipedia.org/wiki/Firebase
  - vendor-label: "Google AI for Developers"
    occurrences: 6
    sources:
      - https://ai.google.dev/
      - https://ai.google.dev/aistudio
```

## A/B Testing

```yaml
source-url: https://firebase.google.com/products/ab-testing
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Optimize your app experience by running experiments to test changes to features, UI, and engagement strategies, then roll out improvements that achieve your goals with Firebase A/B Testing.

## AI Hypercomputer

```yaml
source-url: https://cloud.google.com/solutions/ai-hypercomputer
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_compute_engine.svg
```
AI Hypercomputer is Google Cloud's integrated supercomputing system combining purpose-built AI accelerators (TPUs and GPUs), optimized networking, and AI-optimized software to deliver high-throughput, low-latency training and inference at scale. It includes dynamic workload scheduling and is engineered for the agentic era.

## AlloyDB for PostgreSQL

```yaml
source-url: https://cloud.google.com/products/alloydb
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_alloydb.svg
```
AlloyDB for PostgreSQL is a fully managed PostgreSQL-compatible database service on Google Cloud that delivers enterprise-grade performance, reliability, and security. It combines Google's in-memory columnar engine and AI-assisted vacuum with a PostgreSQL-compatible interface, offering up to 4x faster transactional and 100x faster analytical query performance than standard PostgreSQL.

## AlloyDB Omni

```yaml
source-url: https://cloud.google.com/alloydb/docs/omni/overview
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_alloydb.svg
```
AlloyDB Omni is a downloadable, self-managed version of AlloyDB for PostgreSQL that can run on-premises, in other cloud environments, or on a developer's laptop, extending AlloyDB's performance and AI capabilities to any infrastructure.

## Analytics Hub

```yaml
source-url: https://cloud.google.com/analytics-hub
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bigquery.svg
```
Analytics Hub is a data exchange platform built into BigQuery that enables organizations to share and consume datasets and ML models across organizational boundaries, with optional monetization for data providers.

## App Engine

```yaml
source-url: https://cloud.google.com/appengine
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_app_engine.svg
```
App Engine is a fully managed platform-as-a-service for deploying scalable web applications and APIs in Java, PHP, Node.js, Python, C#, .NET, Ruby, and Go without managing servers or infrastructure. Traffic splitting, versioning, and auto-scaling are built in.

## Apigee API Management

```yaml
source-url: https://cloud.google.com/apigee
vendor-section: "API Management"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_apigee.svg
```
Apigee is Google Cloud's full-lifecycle API management platform that enables organizations to build, manage, secure, monitor, and monetize APIs at any scale. It supports hybrid and multi-cloud deployments and includes developer portals, analytics, bot detection, and governance policies.

## API Gateway

```yaml
source-url: https://cloud.google.com/api-gateway
vendor-section: "API Management"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_api_gateway.svg
```
API Gateway is a fully managed service that lets developers create, secure, and monitor REST APIs for serverless backends built on Cloud Functions, Cloud Run, and App Engine. It handles authentication, logging, and key validation with minimal configuration.

## Application Integration

```yaml
source-url: https://cloud.google.com/application-integration
vendor-section: "Integration Services"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_application_integration.svg
```
Application Integration is an Integration-Platform-as-a-Service (iPaaS) that provides a comprehensive set of tools to connect and automate workflows across cloud and on-premises applications. It offers pre-built connectors, event-driven triggers, and a visual designer for orchestrating multi-step integrations.

## Artifact Registry

```yaml
source-url: https://cloud.google.com/artifact-registry
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_artifact_registry.svg
```
Artifact Registry is the recommended fully managed package registry for Google Cloud, supporting container images (OCI-compatible), Maven, npm, Python, Go, and other language packages in a unified store. It integrates with Cloud Build, Cloud Deploy, and CI/CD systems for secure software supply chain management.

## Assured Workloads

```yaml
source-url: https://cloud.google.com/security/products/assured-workloads
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)", "FedRAMP High", "Google Sovereign Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_assured_workloads.svg
```
Assured Workloads provides data boundary, compliance, and sovereignty controls that restrict where data is processed and stored within Google Cloud without requiring a physically separate cloud. It supports FedRAMP, ITAR, DoD, HIPAA, and sovereign cloud configurations.

## Bare Metal Solution

```yaml
source-url: https://cloud.google.com/bare-metal
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bare_metal.svg
```
Bare Metal Solution provides dedicated bare-metal servers in Google Cloud colocation facilities to run specialized workloads such as Oracle databases that require direct hardware access without a hypervisor layer. Servers are connected to Google Cloud services via low-latency networking.

## BigQuery

```yaml
source-url: https://cloud.google.com/bigquery
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bigquery.svg
```
BigQuery is Google Cloud's fully managed, serverless, and highly scalable enterprise data warehouse designed for analytics. It supports SQL queries on petabyte-scale datasets, built-in ML (BigQuery ML), geospatial analytics, and native integration with AI services for the autonomous data-to-AI platform.

## BigQuery Data Transfer Service

```yaml
source-url: https://cloud.google.com/bigquery-transfer
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bigquery.svg
```
BigQuery Data Transfer Service automates data movement into BigQuery on a scheduled, managed basis from SaaS applications, other Google products, and external cloud storage without writing a single line of code. It supports sources including Google Ads, YouTube, Campaign Manager, and Amazon S3.

## BigQuery ML

```yaml
source-url: https://cloud.google.com/bigquery/docs/bqml-introduction
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bigquery.svg
```
BigQuery ML allows data scientists and analysts to create, train, and evaluate ML models directly in BigQuery using SQL queries, covering predictive tasks such as regression, classification, and time-series forecasting, as well as generative AI inference via remote Vertex AI models.

## Binary Authorization

```yaml
source-url: https://cloud.google.com/binary-authorization
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_binary_authorization.svg
```
Binary Authorization is a deploy-time security control for container images that ensures only trusted, policy-compliant images are deployed to Google Kubernetes Engine, Cloud Run, or Anthos. It integrates with software supply chain tools to enforce attestation requirements.

## Certificate Manager

```yaml
source-url: https://cloud.google.com/certificate-manager
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_certificate_manager.svg
```
Certificate Manager lets you acquire, manage, and deploy Transport Layer Security (TLS) certificates for use with Cloud Load Balancing and Traffic Director. It supports Google-managed certificates, self-managed certificates, and Certificate Authority Service integration.

## Chronicle SIEM

```yaml
source-url: https://cloud.google.com/security/products/security-information-event-management
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_chronicle.svg
```
Chronicle SIEM is Google Cloud's cloud-native security information and event management service that ingests petabytes of security telemetry, enriches events with Mandiant threat intelligence, and enables threat detection at Google scale. It is part of the unified Google Security Operations platform.

## Chronicle SOAR

```yaml
source-url: https://cloud.google.com/security/products/security-operations
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_chronicle.svg
```
Chronicle SOAR is a security orchestration, automation, and response platform that unifies with Chronicle SIEM to help security operations teams automate repetitive tasks, manage playbooks, and accelerate incident response. It is part of the Google Security Operations suite.

## Cloud Armor

```yaml
source-url: https://cloud.google.com/security/products/armor
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_armor.svg
```
Cloud Armor is a DDoS protection and web application firewall service that filters traffic at Google's global edge before it reaches your load balancers. It provides adaptive protection against volumetric DDoS attacks, OWASP-based rules, geo-based blocking, and reCAPTCHA Enterprise integration.

## Cloud Asset Inventory

```yaml
source-url: https://cloud.google.com/asset-inventory
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_asset_inventory.svg
```
Cloud Asset Inventory is a global metadata inventory service that provides visibility, search, and monitoring across all Google Cloud assets. It supports discovery, change tracking, policy analysis, and compliance checking across an organization's entire resource hierarchy.

## Cloud Batch

```yaml
source-url: https://cloud.google.com/batch
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_batch.svg
```
Cloud Batch is a fully managed batch processing service that provisions and manages computing resources to execute batch workloads on Compute Engine VMs, including support for GPU and Spot VM instance types. It handles job scheduling, node management, and automatic retries.

## Cloud Bigtable

```yaml
source-url: https://cloud.google.com/bigtable
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_bigtable.svg
```
Cloud Bigtable is a fully managed, petabyte-scale NoSQL database service ideal for low-latency, high-throughput workloads such as time-series data, AdTech, financial data, and IoT analytics. It supports HBase API compatibility and sub-millisecond read latency with an in-memory tier.

## Cloud Billing

```yaml
source-url: https://cloud.google.com/billing/docs
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_billing.svg
```
Cloud Billing provides tools to track, understand, and manage all Google Cloud spending, including billing accounts, budgets, alerts, committed use discounts, and cost export to BigQuery for detailed analysis and financial governance.

## Cloud Build

```yaml
source-url: https://cloud.google.com/build
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_build.svg
```
Cloud Build is a fully managed continuous integration and continuous delivery service that executes builds on Google Cloud infrastructure. It integrates with GitHub, GitLab, and Bitbucket, supports parallel build steps in containers, and feeds downstream into Cloud Deploy for delivery automation.

## Cloud CDN

```yaml
source-url: https://cloud.google.com/cdn
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_cdn.svg
```
Cloud CDN leverages Google's globally distributed edge points of presence to cache HTTP(S) content close to users, reducing latency for static and dynamic workloads. It integrates with Cloud Load Balancing and supports signed URLs, cache invalidation, and edge security.

## Cloud Code

```yaml
source-url: https://cloud.google.com/code
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_code.svg
```
Cloud Code provides IDE extensions for VS Code and JetBrains IDEs to write, run, and debug cloud-native Kubernetes and Cloud Run applications directly from the developer's workstation. It includes YAML authoring assistance, secret management, and integration with Google Cloud services.

## Cloud Composer

```yaml
source-url: https://cloud.google.com/composer
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_composer.svg
```
Cloud Composer is a fully managed workflow orchestration service built on Apache Airflow that enables authors to author, schedule, and monitor pipelines spanning multiple cloud providers and on-premises environments. Cloud Composer 3 supports Apache Airflow 3 with DAG versioning and a modern UI.

## Cloud Data Fusion

```yaml
source-url: https://cloud.google.com/data-fusion
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_data_fusion.svg
```
Cloud Data Fusion is a fully managed, cloud-native data integration service providing a graphical interface for building and managing ETL/ELT pipelines. It is based on the open source CDAP framework and includes 150+ pre-built connectors and transformations for a code-free pipeline experience.

## Cloud Datastore

```yaml
source-url: https://cloud.google.com/datastore
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_datastore.svg
```
Cloud Datastore is a highly scalable NoSQL document database for web and mobile applications, now superseded by Firestore in Datastore mode. It provides automatic sharding and replication, ACID transactions, and SQL-like query support without server management.

## Cloud Deploy

```yaml
source-url: https://cloud.google.com/deploy
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_deploy.svg
```
Cloud Deploy is a fully managed continuous delivery service that automates the progressive delivery of application changes to a series of targets — development, staging, and production — for Google Kubernetes Engine, Cloud Run, and Anthos. It provides approval gates, rollback capabilities, and deployment metrics.

## Cloud DNS

```yaml
source-url: https://cloud.google.com/dns
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_dns.svg
```
Cloud DNS is a scalable, reliable, and fully managed authoritative Domain Name System service running on Google's infrastructure with a 100% uptime SLA. It supports public and private zones, DNSSEC, split-horizon DNS, and managed zones across projects.

## Cloud Endpoints

```yaml
source-url: https://cloud.google.com/endpoints
vendor-section: "API Management"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_endpoints.svg
```
Cloud Endpoints is an NGINX-based API proxy that provides distributed API management capabilities for APIs built on Cloud Functions, App Engine, GKE, or Compute Engine. It handles authentication, monitoring via Cloud Logging and Cloud Trace, and OpenAPI or gRPC specification support.

## Cloud Firewall

```yaml
source-url: https://cloud.google.com/firewall
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_firewall.svg
```
Cloud Firewall provides distributed, stateful inspection firewall capabilities for Google Cloud VPC networks. It offers hierarchical firewall policies, network tags, service accounts-based rules, and Cloud Firewall Plus with intrusion prevention powered by Palo Alto Networks.

## Cloud Functions

```yaml
source-url: https://cloud.google.com/functions
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_functions.svg
```
Cloud Functions is a serverless execution environment for building and connecting cloud services with event-driven functions in Node.js, Python, Go, Java, Ruby, PHP, and .NET. Cloud Functions (2nd gen) is built on Cloud Run and supports larger instances, longer timeouts, and concurrency.

## Cloud Healthcare API

```yaml
source-url: https://cloud.google.com/healthcare-api
vendor-section: "Healthcare and Life Sciences"
available-in-observed: ["Google Cloud (Commercial)", "FedRAMP High"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_healthcare_api.svg
```
Cloud Healthcare API is a managed service that enables ingestion, storage, analysis, and retrieval of healthcare data in standard medical formats including FHIR R4, DICOM, and HL7v2. It provides de-identification, consent management, and integration with HIPAA-compliant Google Cloud services.

## Cloud Identity

```yaml
source-url: https://cloud.google.com/identity
vendor-section: "Identity and Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_identity.svg
```
Cloud Identity is an identity-as-a-service platform that provides unified user and device management for both Google Workspace and Google Cloud, supporting SSO via SAML 2.0 and OIDC, multi-factor authentication, endpoint management, and workforce identity federation.

## Cloud Identity-Aware Proxy

```yaml
source-url: https://cloud.google.com/iap
vendor-section: "Identity and Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_iap.svg
```
Cloud Identity-Aware Proxy establishes a central authorization layer for applications accessed by HTTPS, enabling context-aware access to applications without a VPN. It enforces access policies based on user identity and request context using BeyondCorp Zero Trust principles.

## Cloud Interconnect

```yaml
source-url: https://cloud.google.com/interconnect
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_interconnect.svg
```
Cloud Interconnect provides dedicated or partner-based high-bandwidth, low-latency physical connections between on-premises networks and Google Cloud VPC networks. It supports Dedicated Interconnect (10G and 400G options) and Partner Interconnect through 159+ global locations.

## Cloud IDS

```yaml
source-url: https://cloud.google.com/intrusion-detection-system
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_ids.svg
```
Cloud IDS is a cloud-native, managed network-based intrusion detection system powered by Palo Alto Networks threat intelligence that provides full packet visibility and threat detection for network traffic. It is deployed as a mirrored traffic tap within VPC networks.

## Cloud Key Management Service

```yaml
source-url: https://cloud.google.com/kms
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)", "Google Sovereign Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_kms.svg
```
Cloud Key Management Service is a hosted key management service that lets organizations manage symmetric and asymmetric cryptographic keys in a centralized cloud service. It integrates with IAM for fine-grained access control and supports automatic key rotation, HSM-backed keys, and external key management via EKM.

## Cloud Load Balancing

```yaml
source-url: https://cloud.google.com/load-balancing
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_load_balancing.svg
```
Cloud Load Balancing is a fully distributed, software-defined managed service for all types of traffic using a single anycast IP. It supports HTTP(S), TCP, SSL proxy, and internal load balancing across Google Cloud regions and on-premises backends, with model-aware routing for AI inference workloads.

## Cloud Logging

```yaml
source-url: https://cloud.google.com/logging
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_logging.svg
```
Cloud Logging is a fully managed service that performs at scale to ingest, index, and store application, audit, and platform log data from GKE, VMs, and other Google Cloud services. It provides real-time log streaming, alerting, and export to Cloud Storage, BigQuery, or Pub/Sub.

## Cloud Monitoring

```yaml
source-url: https://cloud.google.com/monitoring
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_monitoring.svg
```
Cloud Monitoring provides full-stack observability for applications and infrastructure on Google Cloud, AWS, or on-premises. It collects metrics, events, and metadata, and enables dashboards, alerting policies, uptime checks, and synthetic monitoring to ensure application health.

## Cloud NAT

```yaml
source-url: https://cloud.google.com/nat
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_nat.svg
```
Cloud NAT is a distributed, software-defined managed network address translation service that lets VM instances and GKE nodes without external IP addresses create outbound connections to the internet. It supports IPv6 through combined DNS64 and NAT64 for IPv6-only workloads.

## Cloud Profiler

```yaml
source-url: https://cloud.google.com/profiler
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_profiler.svg
```
Cloud Profiler is a statistical, low-overhead production profiler that continuously analyzes CPU and memory consumption of applications running on Google Cloud, on-premises, or other clouds. It produces flame graphs to identify performance bottlenecks and reduce latency and cost.

## Cloud Router

```yaml
source-url: https://cloud.google.com/network-connectivity/docs/router
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_router.svg
```
Cloud Router is a fully managed, distributed BGP routing service that dynamically exchanges routes between a VPC network and on-premises networks connected via Cloud VPN or Cloud Interconnect. It also manages Cloud NAT gateways.

## Cloud Run

```yaml
source-url: https://cloud.google.com/run
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_run.svg
```
Cloud Run is a fully managed compute platform that automatically scales stateless containers, running them only during request processing and scaling to zero when idle. It supports HTTP requests, events via Eventarc, background jobs via Cloud Run Jobs, and direct VPC connectivity for private services.

## Cloud Security Command Center

```yaml
source-url: https://cloud.google.com/security/products/security-command-center
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_security_command_center.svg
```
Security Command Center is Google Cloud's centralized risk platform that provides threat detection, vulnerability management, compliance reporting, and attack path simulation across an entire Google Cloud organization. Its Standard tier now includes data security posture management and risk analysis at no additional cost.

## Cloud Shell

```yaml
source-url: https://cloud.google.com/shell
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_shell.svg
```
Cloud Shell provides a browser-based interactive command-line environment with pre-installed Google Cloud tools, a 5 GB persistent home directory, and a built-in code editor. It gives instant access to all Google Cloud services without local installation.

## Cloud Spanner

```yaml
source-url: https://cloud.google.com/spanner
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_spanner.svg
```
Cloud Spanner is a fully managed, globally distributed relational database with unlimited horizontal scaling and a 99.999% availability SLA. It combines ACID transactions with SQL semantics and supports multi-model capabilities including Spanner Graph for querying complex relationships alongside relational data.

## Cloud SQL

```yaml
source-url: https://cloud.google.com/sql
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_sql.svg
```
Cloud SQL is a fully managed relational database service for MySQL, PostgreSQL, and SQL Server with automated patching, backups, replication, and failover. It includes AI-assisted query performance optimization and integrates with Vertex AI for generative AI capabilities within the database.

## Cloud Storage

```yaml
source-url: https://cloud.google.com/storage
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_storage.svg
```
Cloud Storage is Google Cloud's unified object storage service for unstructured data, offering high durability and availability across multi-regional, regional, nearline, coldline, and archive storage classes. It includes Rapid Cache (SSD-backed read caching) and Cloud Storage FUSE for filesystem-style access from AI frameworks.

## Cloud Tasks

```yaml
source-url: https://cloud.google.com/tasks
vendor-section: "Integration Services"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_tasks.svg
```
Cloud Tasks is a fully managed service for managing the execution, dispatch, and delivery of a large number of distributed tasks. It decouples task creation from task processing and supports HTTP target tasks and App Engine task queues with configurable rate controls and retry policies.

## Cloud Trace

```yaml
source-url: https://cloud.google.com/trace
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_trace.svg
```
Cloud Trace is a distributed tracing system for applications on Google Cloud that collects latency data from applications and displays it in near real time. It helps developers understand request flow, identify performance bottlenecks, and analyze service dependencies.

## Cloud TPU

```yaml
source-url: https://cloud.google.com/tpu
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_tpu.svg
```
Cloud TPU provides Google's custom Tensor Processing Units as cloud-hosted accelerators for AI model training and inference workloads. The latest generation Ironwood TPUs (7th gen) deliver 4,614 TFLOPs FP8 per chip; earlier Trillium (v6e) and v5p generations remain available for various workload profiles.

## Cloud VPN

```yaml
source-url: https://cloud.google.com/vpn
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_vpn.svg
```
Cloud VPN securely connects peer networks to Google Cloud VPC networks through IPsec VPN tunnels with HA VPN providing a 99.99% SLA. It supports IKEv1/v2, dynamic routing via Cloud Router, and HA VPN over Cloud Interconnect for encryption over dedicated links.

## Cloud Workstations

```yaml
source-url: https://cloud.google.com/workstations
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_workstations.svg
```
Cloud Workstations provides managed, secure, preconfigured cloud-based development environments with customizable machine types, persistent disks, and support for VS Code, JetBrains IDEs, and other editors. Admins centrally manage environment configuration, updates, and security policies.

## Colab Enterprise

```yaml
source-url: https://cloud.google.com/colab/docs/introduction
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_colab.svg
```
Colab Enterprise is a fully managed, secure Jupyter notebook environment natively integrated into Vertex AI and BigQuery on Google Cloud. It provides data scientists and ML engineers with collaborative notebooks backed by Google Cloud compute without managing any infrastructure.

## Compute Engine

```yaml
source-url: https://cloud.google.com/products/compute
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_compute_engine.svg
```
Compute Engine is Google Cloud's Infrastructure-as-a-Service offering that provides virtual machine instances running on Google's data center infrastructure. It supports general-purpose, compute-optimized, memory-optimized, storage-optimized, and accelerator-optimized machine families, including Spot VMs, sole-tenant nodes, and bare-metal instances.

## Confidential Computing

```yaml
source-url: https://cloud.google.com/confidential-computing
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_confidential_computing.svg
```
Confidential Computing protects data in use by performing computation within hardware-based Trusted Execution Environments (TEEs). Google Cloud supports Confidential VMs on N2D, C2D, C3D, and accelerator-optimized A3 machine series, enabling privacy-preserving AI and secure multi-party data analytics.

## Contact Center AI

```yaml
source-url: https://cloud.google.com/solutions/contact-center
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_contact_center_ai.svg
```
Contact Center AI (CCAI) is Google Cloud's AI-driven Contact Center as a Service platform that provides omni-channel routing, intelligent Virtual Agent, Agent Assist, and Insights capabilities. It is purpose-built to work alongside CRMs and delivers AI-based automation across voice and digital channels.

## Cross-Cloud Interconnect

```yaml
source-url: https://cloud.google.com/network-connectivity/docs/interconnect/concepts/cci-overview
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_interconnect.svg
```
Cross-Cloud Interconnect establishes high-bandwidth dedicated physical connectivity between Google Cloud and other cloud providers including AWS, Microsoft Azure, Oracle Cloud, and Alibaba Cloud. It is generally available at multiple global locations for direct inter-cloud network peering without traversing the public internet.

## Data Studio (formerly Looker Studio)

```yaml
source-url: https://cloud.google.com/looker-studio
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_looker_studio.svg
```
Data Studio (rebranded from Looker Studio in 2026) is a free interactive data visualization and dashboarding tool that connects to over 800 data sources including BigQuery, Google Ads, Sheets, and third-party databases. Data Studio Pro adds enterprise security, audit logging, and AI features for scaling teams.

## Database Migration Service

```yaml
source-url: https://cloud.google.com/database-migration
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_database_migration.svg
```
Database Migration Service is a fully managed service for migrating databases to Google Cloud with minimal downtime. It supports homogeneous and heterogeneous migrations from MySQL, PostgreSQL, SQL Server, Oracle, and MongoDB sources to Cloud SQL and AlloyDB targets using continuous data replication.

## Dataflow

```yaml
source-url: https://cloud.google.com/products/dataflow
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_dataflow.svg
```
Dataflow is a fully managed unified streaming and batch data processing service based on Apache Beam. It provides automatic scaling, dynamic work rebalancing, and right-fitting for precise resource allocation, and serves as the primary real-time data pipeline engine in Google Cloud's data platform.

## Dataform

```yaml
source-url: https://cloud.google.com/dataform
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_dataform.svg
```
Dataform is a data transformation and pipeline management tool integrated into BigQuery that enables data teams to develop, test, and operationalize SQL-based data pipelines following software engineering best practices including version control, dependency management, and automated testing.

## Dataproc

```yaml
source-url: https://cloud.google.com/dataproc
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_dataproc.svg
```
Dataproc is a managed service for running Apache Hadoop, Apache Spark, Apache Flink, and other big data frameworks on Google Cloud. It provides fast cluster provisioning, easy scaling including scale-to-zero, and integrates with BigQuery, Cloud Storage, and Vertex AI for unified data processing.

## Datastream

```yaml
source-url: https://cloud.google.com/datastream
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_datastream.svg
```
Datastream is a serverless change data capture and replication service that enables continuous data ingestion from operational databases including Oracle, MySQL, PostgreSQL, SQL Server, and MongoDB into BigQuery, Cloud Storage, and BigLake Iceberg tables for analytics and lakehouse architectures.

## Document AI

```yaml
source-url: https://cloud.google.com/document-ai
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_document_ai.svg
```
Document AI is an end-to-end document processing platform that uses machine learning to classify, split, and extract structured data from unstructured documents including invoices, contracts, and identity documents. Custom extractor processors are powered by generative AI and can be fine-tuned with as few as 10 sample documents.

## Earth Engine

```yaml
source-url: https://cloud.google.com/earth-engine
vendor-section: "Specialized"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_earth_engine.svg
```
Earth Engine is a cloud-based platform for planetary-scale geospatial data analysis using satellite imagery, climate data, and geospatial datasets curated by Google. It provides a Python and JavaScript API for large-scale environmental analysis and is available to commercial customers and researchers.

## Error Reporting

```yaml
source-url: https://cloud.google.com/error-reporting
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_error_reporting.svg
```
Error Reporting analyzes and aggregates application errors from Cloud Logging across multiple services and instances, automatically groups related errors, and sends notifications when new error patterns emerge. It surfaces error frequency, affected users, and stack traces for rapid diagnosis.

## Eventarc

```yaml
source-url: https://cloud.google.com/eventarc
vendor-section: "Integration Services"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_eventarc.svg
```
Eventarc is a fully managed eventing service that lets developers build event-driven architectures by routing events from more than 90 Google Cloud sources, custom applications, and third-party SaaS to Cloud Run, Cloud Functions, GKE, and Workflows. It uses CloudEvents for standardized event delivery.

## Filestore

```yaml
source-url: https://cloud.google.com/filestore
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_filestore.svg
```
Filestore is a fully managed NFS file storage service for applications that require a traditional filesystem interface. It supports NFSv3 and NFSv4.1 on HDD or SSD tiers and integrates with Compute Engine, GKE, and Cloud Run for shared filesystem access.

## Firebase A/B Testing

```yaml
source-url: https://firebase.google.com/products/ab-testing
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase A/B Testing helps product teams optimize app experiences by running controlled experiments on UI changes, feature flags, and notification strategies, then rolling out the winning variant with statistical significance. It integrates with Remote Config and Cloud Messaging.

## Firebase AI Logic

```yaml
source-url: https://firebase.google.com/products/ai-logic
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase AI Logic (evolved from Vertex AI in Firebase) provides a proxy service and client SDKs to integrate generative AI model capabilities directly into mobile and web applications without building a backend, supporting both direct client-side access and server-side integration via Genkit.

## Firebase App Check

```yaml
source-url: https://firebase.google.com/products/app-check
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase App Check protects backend resources from abuse by verifying that requests originate from authentic app instances on real devices, blocking unauthorized API calls, data scraping, and billing fraud. It integrates with all Firebase services and can extend to custom backends.

## Firebase App Distribution

```yaml
source-url: https://firebase.google.com/products/app-distribution
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase App Distribution makes distributing pre-release iOS and Android apps to testers fast and easy, providing a centralized console for managing tester groups, release notes, and feedback collection. It includes App Testing Agent — a Gemini-powered agent that autonomously generates and runs test cases.

## Firebase App Hosting

```yaml
source-url: https://firebase.google.com/products/app-hosting
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase App Hosting is a serverless web hosting service built for modern full-stack web applications that automatically handles build, deployment, CDN distribution, and scaling from a connected GitHub repository. It abstracts away infrastructure and is generally available for frameworks including Angular and Next.js.

## Firebase Authentication

```yaml
source-url: https://firebase.google.com/products/auth
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Authentication provides a complete identity solution for mobile and web apps with support for email/password, phone number, social login (Google, Apple, Facebook, GitHub), and custom authentication, with drop-in UI components and tight integration with Firestore and other Firebase security rules.

## Firebase Cloud Messaging

```yaml
source-url: https://firebase.google.com/products/cloud-messaging
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Cloud Messaging (FCM) is a cross-platform push notification and messaging service that reliably delivers messages and notifications to iOS, Android, and web applications at no cost. It supports topic-based multicast, device group messaging, and upstream messaging from devices.

## Firebase Crashlytics

```yaml
source-url: https://firebase.google.com/products/crashlytics
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Crashlytics is a real-time crash reporting service that tracks, prioritizes, and fixes stability issues in iOS and Android apps. It provides detailed crash reports, customizable alerts, and integrations with GitHub and Jira, reducing crash investigation time significantly.

## Firebase Data Connect

```yaml
source-url: https://firebase.google.com/products/data-connect
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Data Connect is a new Firebase service powered by Cloud SQL for PostgreSQL that brings relational database capabilities to Firebase apps with a GraphQL-based API, native offline sync, and Firebase Authentication integration for row-level security.

## Firebase Extensions

```yaml
source-url: https://firebase.google.com/products/extensions
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Extensions are pre-packaged, open-source solutions that let developers deploy common functionality to their Firebase projects with minimal code. Extensions handle tasks like image resizing, payments via Stripe, translations, and AI-powered features with built-in configuration and monitoring.

## Firebase Genkit

```yaml
source-url: https://firebase.google.com/products/genkit
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Genkit is an open-source framework for building AI-powered application features with SDKs for JavaScript/TypeScript, Go, and Python. It provides consistent APIs for working with Gemini and other models, a local developer UI for testing and debugging, and production deployment to Firebase or Google Cloud.

## Firebase Hosting

```yaml
source-url: https://firebase.google.com/products/hosting
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Hosting provides fast, secure static and dynamic web hosting backed by a global CDN with automatic SSL certificates, custom domain support, and GitHub-based deploy workflows. It serves HTML, CSS, JavaScript, and other assets with sub-second response times globally.

## Firebase In-App Messaging

```yaml
source-url: https://firebase.google.com/products/in-app-messaging
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase In-App Messaging sends targeted, contextual messages to active app users to guide them toward completing important in-app actions, such as beating a game level or redeeming offers. Messages are triggered by Firestore events, Analytics audiences, or explicit triggers.

## Firebase ML

```yaml
source-url: https://firebase.google.com/products/ml
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase ML provides device-side machine learning capabilities for mobile apps, enabling on-device vision and natural language features such as text recognition, face detection, image labeling, and barcode scanning using Google's ML Kit without a backend server.

## Firebase Performance Monitoring

```yaml
source-url: https://firebase.google.com/products/performance
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Performance Monitoring collects automatic and custom performance traces from real iOS, Android, and web user sessions to surface app startup time, HTTP request latency, screen rendering issues, and custom metrics. Developers can slice performance data by app version, device, and country.

## Firebase Realtime Database

```yaml
source-url: https://firebase.google.com/products/realtime-database
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Realtime Database is a cloud-hosted NoSQL database that stores JSON data and synchronizes it in real time across all connected clients. It supports offline capabilities with automatic resync, rules-based security, and is optimized for real-time use cases like game state, chat, and collaborative editing.

## Firebase Remote Config

```yaml
source-url: https://firebase.google.com/products/remote-config
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Remote Config is a cloud service that lets developers change app behavior and appearance without requiring users to download an update. Configuration values can be personalized by user segment, gradually rolled out, and integrated with A/B Testing experiments.

## Firebase Studio

```yaml
source-url: https://firebase.studio
vendor-section: "Firebase — Build"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Studio is a cloud-based agentic development environment powered by Gemini that enables developers to prototype, build, and manage full-stack AI applications. It integrates with Firebase services and supports generating production-ready apps from natural language prompts.

## Firebase Test Lab

```yaml
source-url: https://firebase.google.com/products/test-lab
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Firebase Test Lab provides a cloud-based app testing infrastructure that runs automated and manual tests on real and virtual iOS and Android devices hosted in Google data centers. It integrates with CI/CD systems and supports Espresso, XCTest, Robo, and Game Loop test types.

## Firestore

```yaml
source-url: https://cloud.google.com/products/firestore
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)", "Firebase"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_firestore.svg
```
Firestore is a fully managed, serverless NoSQL document database for building rich mobile, web, and server applications with real-time synchronization and offline support. It provides strong consistency, ACID transactions, multi-region replication, and integrates natively with Firebase and Google Cloud services.

## Gemini API

```yaml
source-url: https://ai.google.dev/gemini-api/docs
vendor-section: "Google AI for Developers"
available-in-observed: ["Google AI for Developers", "Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
```
Gemini API provides programmatic access to Google's Gemini family of multimodal models for building AI-powered applications. It supports text, image, audio, video, and code inputs with a unified API available via Google AI Studio, Vertex AI, and the Gemini CLI across multiple platforms and languages.

## Gemini Code Assist

```yaml
source-url: https://cloud.google.com/gemini/code-assist
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)", "Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_gemini.svg
```
Gemini Code Assist is an AI-powered coding assistant that provides code generation, completion, explanation, and debugging suggestions directly within IDEs including VS Code, JetBrains, Cloud Shell, and Cloud Workstations. It is powered by Gemini models with a 1M token context window for codebase awareness.

## Gemini Enterprise Agent Platform

```yaml
source-url: https://cloud.google.com/products/gemini-enterprise-agent-platform
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_gemini.svg
```
Gemini Enterprise Agent Platform (formerly Vertex AI) is Google Cloud's comprehensive platform for developers to build, scale, govern, and optimize AI agents. It provides a single destination combining model selection, agent building, Model Garden (200+ models), Agent Studio, Colab Enterprise, and DevOps capabilities for building enterprise agentic applications.

## Google AI Studio

```yaml
source-url: https://ai.google.dev/aistudio
vendor-section: "Google AI for Developers"
available-in-observed: ["Google AI for Developers"]
candidate-icons:
  - https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
```
Google AI Studio is a browser-based IDE for prototyping and testing with Gemini models, offering prompt design, model comparison, and API key generation. It is free of charge in all available regions and serves as the fastest on-ramp to the Gemini API for individual developers.

## Google Analytics for Firebase

```yaml
source-url: https://firebase.google.com/products/analytics
vendor-section: "Firebase — Run"
available-in-observed: ["Firebase"]
candidate-icons:
  - https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png
```
Google Analytics for Firebase is an unlimited, free app measurement solution built into Firebase that provides insights into app usage, user behavior, and engagement. It automatically captures events from Firebase SDK interactions and powers Predictions, A/B Testing, Remote Config personalization, and audience targeting in other Firebase products.

## Google Calendar

```yaml
source-url: https://workspace.google.com/products/calendar/
vendor-section: "Google Workspace — Communication and Scheduling"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png
```
Google Calendar is a cloud-based scheduling and time management service integrated with Gmail, Meet, and Chat that enables users to create events, manage meeting rooms, and coordinate schedules across organizations. It supports shared calendars, meeting room booking, and AI-powered scheduling suggestions.

## Google Chat

```yaml
source-url: https://workspace.google.com/products/chat/
vendor-section: "Google Workspace — Communication and Scheduling"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/chat_2023_48dp.png
```
Google Chat is a team messaging platform for direct messages, group conversations, and Spaces for persistent topic-based collaboration. It is deeply integrated with Gmail, Drive, Docs, and Meet, and supports Google-published and third-party chatbots for workflow automation.

## Google Cloud Armor Enterprise

```yaml
source-url: https://cloud.google.com/armor
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_armor.svg
```
Google Cloud Armor Enterprise is the premium subscription tier of Cloud Armor that bundles DDoS mitigation, WAF services, Google-curated rule sets, adaptive protection, and named IP lists under a predictable monthly price for enterprise customers with high-volume production workloads.

## Google Distributed Cloud

```yaml
source-url: https://cloud.google.com/distributed-cloud
vendor-section: "Compute"
available-in-observed: ["Google Distributed Cloud", "Google Sovereign Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_distributed_cloud.svg
```
Google Distributed Cloud is a portfolio of hardware and software that extends Google Cloud's infrastructure and services to edge locations, customer data centers, and operator networks. It enables sovereign, air-gapped, and on-premises deployments of Google Cloud services including Gemini models and GKE.

## Google Docs

```yaml
source-url: https://workspace.google.com/products/docs/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png
```
Google Docs is a cloud-based word processor that enables real-time collaborative document creation, editing, and commenting. It supports rich formatting, revision history, add-ons, and deep integration with Drive and Gemini for AI-powered writing assistance.

## Google Drive

```yaml
source-url: https://workspace.google.com/products/drive/
vendor-section: "Google Workspace — Storage and Organization"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png
```
Google Drive is a cloud file storage and synchronization service that provides centralized storage for all Workspace content with real-time sync across devices. It supports shared drives for teams, Drive for desktop sync, and AI-powered search and organization via Gemini.

## Google Forms

```yaml
source-url: https://workspace.google.com/products/forms/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/forms_2020q4_48dp.png
```
Google Forms is a survey and quiz creation tool that enables teams to collect and analyze information from respondents, with responses automatically populating linked Google Sheets for analysis. It supports branching logic, AI-assisted question generation, and integration with Google Analytics.

## Google Gemma

```yaml
source-url: https://ai.google.dev/gemma
vendor-section: "Google AI for Developers"
available-in-observed: ["Google AI for Developers", "Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
```
Gemma is a family of lightweight, open-weight models built from the same research and technology as Google's Gemini models, available under a permissive open license. Gemma 4 supports text, audio, and image input across 140+ languages with context windows up to 256K tokens and is designed for fine-tuning and on-device deployment.

## Google Keep

```yaml
source-url: https://workspace.google.com/products/keep/
vendor-section: "Google Workspace — Storage and Organization"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/keep_2020q4_48dp.png
```
Google Keep is a note-taking service integrated with Google Workspace that supports text notes, lists, voice memos, and image capture with real-time sharing and cross-device sync. Notes can be pinned, color-coded, labeled, and reminded by time or location.

## Google Kubernetes Engine

```yaml
source-url: https://cloud.google.com/kubernetes-engine
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_container_engine.svg
```
Google Kubernetes Engine (GKE) is a fully managed Kubernetes service that provides automated cluster provisioning, scaling, upgrades, and security hardening. It supports Autopilot mode for fully managed node operations, Standard mode for fine-grained control, and GKE Enterprise for multi-cluster and hybrid deployments via fleet management.

## Google Maps Platform

```yaml
source-url: https://mapsplatform.google.com/
vendor-section: "Google Maps Platform"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/maps_2020q4_48dp.png
```
Google Maps Platform is a suite of APIs and SDKs that enables developers to embed maps, search for places, calculate routes, and access geospatial data based on Google's comprehensive global maps dataset. Key APIs include Maps JavaScript API, Routes API, Places API, Geocoding API, Map Tiles API, and Aerial View.

## Google Meet

```yaml
source-url: https://workspace.google.com/products/meet/
vendor-section: "Google Workspace — Communication and Scheduling"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/meet_2020q4_48dp.png
```
Google Meet is a video conferencing service supporting meetings, webinars, and large-scale live streams of up to 1,000 participants with noise cancellation, live captions, breakout rooms, and Gemini-powered meeting summaries. It integrates natively with Calendar, Gmail, Chat, and Workspace AI features.

## Google Migration Center

```yaml
source-url: https://cloud.google.com/migration-center
vendor-section: "Migration"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_migration_center.svg
```
Migration Center is a unified migration platform that provides discovery, assessment, and planning tools for migrating on-premises workloads to Google Cloud. It aggregates data from Google and partner tools to generate business cases, rightsizing recommendations, and migration roadmaps.

## Google Security Operations

```yaml
source-url: https://cloud.google.com/security/products/security-operations
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_chronicle.svg
```
Google Security Operations is the unified platform that combines Chronicle SIEM, Chronicle SOAR, and Mandiant threat intelligence with AI-powered investigation and response capabilities. It is a Gartner Magic Quadrant Leader for SIEM and enables security analysts to detect, investigate, and respond to threats at Google scale.

## Google Sheets

```yaml
source-url: https://workspace.google.com/products/sheets/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/sheets_2020q4_48dp.png
```
Google Sheets is a cloud-based spreadsheet application with real-time collaboration, automated saving, and revision history. It includes Gemini-powered formula generation, Connected Sheets for analyzing BigQuery data directly in spreadsheets, and integration with AppSheet for no-code app creation.

## Google Sites

```yaml
source-url: https://workspace.google.com/products/sites/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/sites_2020q4_48dp.png
```
Google Sites is a structured wiki and webpage creation tool for building intranets, project portals, and team sites without coding knowledge. It integrates with other Google Workspace content including Drive files, Docs, Sheets, Slides, and Calendar.

## Google Slides

```yaml
source-url: https://workspace.google.com/products/slides/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/slides_2020q4_48dp.png
```
Google Slides is a cloud-based presentation tool with real-time collaboration, Gemini AI-powered content generation, and integration with other Workspace applications. It supports importing from PowerPoint, generating speaker notes, creating AI avatars, and publishing presentations to the web.

## Google Tasks

```yaml
source-url: https://workspace.google.com/products/tasks/
vendor-section: "Google Workspace — Storage and Organization"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/tasks_google_2020q4_48dp.png
```
Google Tasks is a to-do management application integrated with Gmail and Calendar that lets users create tasks from emails, set due dates, and organize work into lists. It syncs across web and mobile and supports subtasks for structured task tracking.

## Google Vault

```yaml
source-url: https://workspace.google.com/products/vault/
vendor-section: "Google Workspace — Administration and Compliance"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/vault_2020q4_48dp.png
```
Google Vault is an information governance and eDiscovery service for Google Workspace that enables administrators to retain, hold, search, and export user data from Gmail, Drive, Chat, Meet, and Groups for legal and compliance purposes. It now supports retention and search of Gemini app prompts.

## Google Vids

```yaml
source-url: https://workspace.google.com/products/vids/
vendor-section: "Google Workspace — Content Creation"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/vids_2024_48dp.png
```
Google Vids is an AI-powered video creation tool in Google Workspace that generates video drafts from text prompts, Slides content, or uploaded media. It uses Gemini to generate scripts, voiceovers, and background music, and supports AI avatars for team communications and training content.

## Google Voice

```yaml
source-url: https://workspace.google.com/products/voice/
vendor-section: "Google Workspace — Communication and Scheduling"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/voice_2023_48dp.png
```
Google Voice is an optional cloud telephony add-on for Google Workspace that provides business phone numbers, call routing, voicemail transcription, and call management. It integrates with Meet, Calendar, and the Google Workspace Admin console for centralized communications management.

## Gmail

```yaml
source-url: https://workspace.google.com/products/gmail/
vendor-section: "Google Workspace — Communication and Scheduling"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png
```
Gmail is Google Workspace's email service providing end-to-end encrypted email with 99.9% uptime, advanced spam and phishing protection, and Gemini-powered features including Smart Compose, email summarization, and AI-assisted drafting. It integrates with Calendar, Meet, Chat, and third-party add-ons via the Workspace Marketplace.

## GKE Enterprise

```yaml
source-url: https://cloud.google.com/kubernetes-engine/docs/concepts/gke-enterprise
vendor-section: "Compute"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_container_engine.svg
```
GKE Enterprise (formerly Anthos) is a managed application platform for running containerized workloads across Google Cloud, other public clouds, and on-premises data centers from a single control plane. It provides fleet management, Config Management, Policy Controller, Service Mesh, and multi-cluster observability.

## Integration Connectors

```yaml
source-url: https://cloud.google.com/integration-connectors
vendor-section: "Integration Services"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_integration_connectors.svg
```
Integration Connectors is a managed connectivity service providing pre-built connectors to over 100 enterprise applications including Salesforce, SAP, ServiceNow, and Workday. It enables Application Integration and Apigee workflows to securely exchange data with external systems without managing authentication or networking.

## Knowledge Catalog

```yaml
source-url: https://cloud.google.com/products/knowledge-catalog
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_dataplex.svg
```
Knowledge Catalog (formerly Dataplex) is a unified, intelligent data catalog and governance platform that aggregates metadata across Google Cloud and partner data platforms into a single governed source of truth. It provides data discovery, classification, business glossary, data quality, and lineage tracking through Dataplex Universal Catalog.

## Local SSD

```yaml
source-url: https://cloud.google.com/local-ssd
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_persistent_disk.svg
```
Local SSD provides high-performance ephemeral block storage physically attached to Compute Engine VMs for workloads that require extremely high IOPS and low latency. Local SSD data is not persisted when the VM is stopped and is designed for temporary storage of frequently accessed cached data.

## Looker

```yaml
source-url: https://cloud.google.com/looker
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)", "FedRAMP High"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_looker.svg
```
Looker is an enterprise business intelligence and analytics platform based on a semantic layer (LookML) that ensures consistent metric definitions across all reports and AI-powered queries. It supports embedded analytics, conversational analytics agents, and direct database connectivity to BigQuery and other warehouses.

## Managed Lustre

```yaml
source-url: https://cloud.google.com/managed-lustre
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_filestore.svg
```
Managed Lustre is a fully managed first-party parallel file system built on DDN EXAScaler Lustre, providing up to 10 TB/s of throughput and millions of IOPS for AI and HPC workloads. It replaces Parallelstore as Google Cloud's primary parallel file system and is integrated with GKE and Compute Engine.

## Mandiant Threat Intelligence

```yaml
source-url: https://cloud.google.com/security/products/threat-intelligence
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_mandiant.svg
```
Mandiant Threat Intelligence provides operational, strategic, and tactical threat intelligence from Mandiant's frontline incident response and threat research teams, integrated with Google Security Operations for enriched threat detection and attack surface management across the enterprise.

## Memorystore

```yaml
source-url: https://cloud.google.com/memorystore
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_memorystore.svg
```
Memorystore is a fully managed in-memory database service for Valkey, Redis, and Memcached on Google Cloud, providing high-availability caching with sub-millisecond read/write latency. It handles patching, monitoring, and failover automatically with VPC-native connectivity and IAM-based access control.

## Migrate to Containers

```yaml
source-url: https://cloud.google.com/products/cloud-migration/containers
vendor-section: "Migration"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_migrate_to_containers.svg
```
Migrate to Containers modernizes traditional VM-based applications into containerized workloads running on GKE or Cloud Run by automatically extracting and transforming application components. It supports physical-to-Kubernetes (P2K) migrations and is offered at no charge for migrations to Google Cloud.

## Migrate to Virtual Machines

```yaml
source-url: https://cloud.google.com/products/cloud-migration/virtual-machines
vendor-section: "Migration"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_compute_engine.svg
```
Migrate to Virtual Machines (formerly Velostrata) replicates VMware, Hyper-V, and cloud VMs to Compute Engine with near-zero downtime using live streaming migration. It supports automated conversion of VM formats to GCE images and migration task runbook automation.

## Model Garden

```yaml
source-url: https://cloud.google.com/model-garden
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_gemini.svg
```
Model Garden is the model catalog within Gemini Enterprise Agent Platform providing curated access to 200+ AI models including Google's first-party Gemini family (Gemini 3.1 Pro, Gemini 3.1 Flash, Imagen 4, Veo 3, Lyria 2, Chirp 3) alongside open models from the community. It enables serverless deployment, fine-tuning, and batch prediction from a single console.

## Natural Language AI

```yaml
source-url: https://cloud.google.com/natural-language
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_natural_language.svg
```
Natural Language AI provides pre-trained machine learning models for text analysis including entity extraction, sentiment analysis, content classification, and syntax analysis via REST and RPC APIs. It supports healthcare entity analysis for clinical text and is used as a building block for document understanding applications.

## NetApp Volumes

```yaml
source-url: https://cloud.google.com/netapp/volumes
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_filestore.svg
```
Google Cloud NetApp Volumes is a fully managed file storage service powered by NetApp technology providing high-performance NFS and SMB file shares on Google Cloud. It is designed for enterprise workloads migrating from on-premises NetApp environments and supports ONTAP-compatible features.

## Network Connectivity Center

```yaml
source-url: https://cloud.google.com/network-connectivity-center
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_network_connectivity_center.svg
```
Network Connectivity Center delivers a unified hub-and-spoke connectivity management model that uses Google's global network to transfer data across on-premises sites, Google Cloud regions, and other cloud providers via Interconnect, VPN, and SD-WAN integrations. It provides centralized configuration and monitoring of all hybrid network connections.

## NotebookLM

```yaml
source-url: https://notebooklm.google.com/
vendor-section: "Google Workspace — AI and Productivity"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
```
NotebookLM is an AI-powered research and note-taking assistant that grounds its responses exclusively in user-uploaded sources including documents, PDFs, YouTube videos, and Google Drive files. NotebookLM Business is included in Google Workspace plans with enterprise SLAs, admin controls, and data governance guarantees.

## Parallelstore

```yaml
source-url: https://cloud.google.com/parallelstore
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_filestore.svg
```
Parallelstore is a fully managed, high-performance parallel file system built on Intel DAOS providing low-latency distributed file storage for AI/ML scratch workloads and HPC applications. Note: Parallelstore is scheduled for deprecation on October 31, 2026, with Google Cloud Managed Lustre as the successor.

## Persistent Disk

```yaml
source-url: https://cloud.google.com/persistent-disk
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_persistent_disk.svg
```
Persistent Disk is Google Cloud's primary block storage service for Compute Engine VMs and GKE nodes, available as HDD (Standard) or SSD in regional and zonal configurations. It supports live resizing, snapshots, machine image creation, and multi-writer mode for shared read-write access.

## Private Service Connect

```yaml
source-url: https://cloud.google.com/vpc/docs/private-service-connect
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_private_service_connect.svg
```
Private Service Connect enables consumers to access managed Google APIs and services from within their VPC network using internal IP addresses, so traffic never traverses the public internet. It also allows producers to publish services privately to specific consumer VPCs with granular access control.

## Pub/Sub

```yaml
source-url: https://cloud.google.com/pubsub
vendor-section: "Data Analytics"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_pubsub.svg
```
Pub/Sub is a fully managed, real-time messaging and event streaming service for decoupled asynchronous communication between services at any scale. It supports push and pull delivery, Pub/Sub Lite for cost-optimized streaming, and Single Message Transforms (SMTs) with JavaScript UDFs for real-time data enrichment.

## reCAPTCHA Enterprise

```yaml
source-url: https://cloud.google.com/security/products/recaptcha
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_recaptcha.svg
```
reCAPTCHA Enterprise is a fraud protection and bot detection service that uses advanced risk analysis to differentiate human users from automated bots on websites and mobile applications. It provides granular risk scores, reason codes for suspicious events, MFA triggers, and password breach detection.

## Recommendations AI

```yaml
source-url: https://cloud.google.com/recommendations-ai
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_recommendations_ai.svg
```
Recommendations AI is a fully managed service that delivers personalized product recommendations to customers using the same ML recommendation technology that powers Google Search, YouTube, and Google Ads. It handles model training, serving, and A/B testing automatically.

## Resource Manager

```yaml
source-url: https://cloud.google.com/resource-manager
vendor-section: "Management Tools"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_resource_manager.svg
```
Resource Manager provides a hierarchical resource container (organizations, folders, projects) for organizing and centrally managing all Google Cloud resources. It enforces organization-level IAM policies, organizational policies for constraint enforcement, and inheritance-based access controls across the entire resource hierarchy.

## Secret Manager

```yaml
source-url: https://cloud.google.com/secret-manager
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_secret_manager.svg
```
Secret Manager is a managed secrets service for storing, accessing, and auditing API keys, passwords, certificates, and other sensitive configuration data. It integrates with Cloud KMS for encryption, Cloud IAM for access control, and Cloud Audit Logs for compliance, and supports automatic secret rotation.

## Secure Source Manager

```yaml
source-url: https://cloud.google.com/secure-source-manager
vendor-section: "Developer Tools"
available-in-observed: ["Google Cloud (Commercial)", "Google Sovereign Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_cloud_source_repositories.svg
```
Secure Source Manager is a fully managed, private Git repository service that provides a high-security hosting environment for source code with data residency guarantees, VPC Service Controls integration, and CMEK encryption. It is designed for highly regulated industries with strict compliance requirements.

## Service Directory

```yaml
source-url: https://cloud.google.com/service-directory
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_service_directory.svg
```
Service Directory is a managed service registry that provides a single place to publish, discover, and connect to services regardless of their location — on-premises, hybrid, or multi-cloud. It integrates with Cloud DNS, Private Service Connect, and Traffic Director for service-level networking.

## Spanner Omni

```yaml
source-url: https://cloud.google.com/products/spanner/omni
vendor-section: "Databases"
available-in-observed: ["Google Cloud (Commercial)", "Google Distributed Cloud"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_spanner.svg
```
Spanner Omni is a downloadable, self-managed version of Cloud Spanner that extends Spanner's globally distributed, multi-model database capabilities to on-premises environments, other clouds, or developer laptops. It maintains API compatibility with the hosted service and supports Spanner Graph and relational workloads.

## Speech-to-Text

```yaml
source-url: https://cloud.google.com/speech-to-text
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_speech_to_text.svg
```
Speech-to-Text converts audio to text using Google's deep learning neural network algorithms with support for 125+ languages, real-time streaming transcription, speaker diarization, and automatic punctuation. Chirp 3 extends the service with instant custom voice creation and high-fidelity audio generation and understanding.

## Storage Transfer Service

```yaml
source-url: https://cloud.google.com/storage-transfer-service
vendor-section: "Storage"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_storage_transfer.svg
```
Storage Transfer Service enables automated, scheduled data movement from online sources (Amazon S3, Azure Blob Storage, HTTP/HTTPS URLs) and on-premises file systems to Cloud Storage. It provides bandwidth control, filtering, and deletion options for large-scale data migrations and regular synchronization.

## Text-to-Speech

```yaml
source-url: https://cloud.google.com/text-to-speech
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_text_to_speech.svg
```
Text-to-Speech converts text into natural-sounding audio using WaveNet and Neural2 voices across 50+ languages with Studio voices for premium lifelike speech. It is built on Chirp 3 technology, which supports Instant Custom Voice creation from 10 seconds of audio.

## Traffic Director

```yaml
source-url: https://cloud.google.com/traffic-director
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_traffic_director.svg
```
Traffic Director is a fully managed traffic control plane for service meshes on Google Cloud that programs Envoy proxies for global load balancing, traffic management, and observability across GKE, Compute Engine, and hybrid deployments. It supports advanced traffic policies including circuit breaking, fault injection, and canary deployments.

## Transfer Appliance

```yaml
source-url: https://cloud.google.com/transfer-appliance
vendor-section: "Migration"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_transfer_appliance.svg
```
Transfer Appliance is a rack-mountable physical device for secure offline bulk data transfer to Google Cloud when network bandwidth is insufficient or cost-prohibitive. It is available in 100 TB and 480 TB capacity configurations and is shipped with encrypted storage to Google facilities for data ingestion.

## Translation AI

```yaml
source-url: https://cloud.google.com/translate
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_translation.svg
```
Translation AI provides neural machine translation via the Cloud Translation API for dynamically translating text between 100+ languages, plus AutoML Translation for training custom domain-specific models. Translation Hub extends this with document translation management workflows for large-scale enterprise content localization.

## Vertex AI Workbench

```yaml
source-url: https://cloud.google.com/vertex-ai-workbench
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_vertex_ai.svg
```
Vertex AI Workbench provides managed JupyterLab notebook instances integrated with Google Cloud services for data science and machine learning development. It supports both user-managed and managed instances with deep integration into BigQuery, Cloud Storage, and Gemini Enterprise Agent Platform.

## Video Intelligence API

```yaml
source-url: https://cloud.google.com/video-intelligence
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_video_intelligence.svg
```
Video Intelligence API makes video content searchable and discoverable by identifying and annotating objects, activities, text, explicit content, and logos in stored and streaming video. It supports label detection, shot change detection, speech transcription, and face/person tracking.

## Virtual Private Cloud

```yaml
source-url: https://cloud.google.com/vpc
vendor-section: "Networking"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_vpc.svg
```
Virtual Private Cloud (VPC) provides a global, software-defined network for all Google Cloud resources with subnets spanning multiple regions, fine-grained firewall rules, flow logs, and private connectivity to Google APIs. Shared VPC enables centralized network administration across multiple projects.

## Vision AI

```yaml
source-url: https://cloud.google.com/vision
vendor-section: "AI and Machine Learning"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_vision.svg
```
Vision AI provides pre-trained machine learning models for image analysis via the Cloud Vision API, detecting objects, faces, logos, landmarks, and text (OCR) within images. AutoML Vision extends this with custom image classification and object detection training without ML expertise.

## VPC Service Controls

```yaml
source-url: https://cloud.google.com/vpc-service-controls
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_vpc_service_controls.svg
```
VPC Service Controls creates security perimeters around Google Cloud services to prevent data exfiltration. It restricts data movement between projects and services using resource-based access control, with Violation Analyzer and Violation Dashboard for diagnosing access denial events.

## Web Risk API

```yaml
source-url: https://cloud.google.com/web-risk
vendor-section: "Security"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_web_risk.svg
```
Web Risk API enables client applications to check URLs against Google's continuously updated lists of unsafe web resources — phishing, malware, and unwanted software. It is used to warn users before they navigate to dangerous pages or download malicious files.

## Workflows

```yaml
source-url: https://cloud.google.com/workflows
vendor-section: "Integration Services"
available-in-observed: ["Google Cloud (Commercial)"]
candidate-icons:
  - https://www.gstatic.com/cloud/images/icons/icon_workflows.svg
```
Workflows is a fully managed, serverless orchestration service for integrating Google Cloud and HTTP-based services into stateful workflows. It provides YAML/JSON-based workflow syntax, built-in error handling, conditional branching, sub-workflows, and callback endpoints for long-running processes.

## Workspace Admin

```yaml
source-url: https://workspace.google.com/products/admin/
vendor-section: "Google Workspace — Administration and Compliance"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/admin_2020q4_48dp.png
```
Google Workspace Admin is the centralized management console for Google Workspace that allows IT administrators to manage users, devices, security policies, apps, and billing across an organization. It provides unified management across Workspace, Chrome Enterprise, ChromeOS, and Android from a single interface.

## Workspace AppSheet

```yaml
source-url: https://workspace.google.com/products/appsheet/
vendor-section: "Google Workspace — AI and Productivity"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/appsheet_2023_48dp.png
```
AppSheet is a no-code application development platform integrated with Google Workspace that enables business users to build mobile and web apps from Google Sheets, Drive, BigQuery, and other data sources. Gemini-powered features automatically extract information from images and PDFs within app workflows.

## Workspace Endpoint Management

```yaml
source-url: https://workspace.google.com/products/admin/endpoint-management/
vendor-section: "Google Workspace — Administration and Compliance"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/admin_2020q4_48dp.png
```
Workspace Endpoint Management allows administrators to enforce security policies on Android, iOS, Windows, Mac, and ChromeOS devices accessing Google Workspace data. It supports mobile device management (MDM), remote wipe, device enrollment, and app distribution from the Admin console.

## Workspace Intelligence

```yaml
source-url: https://workspace.google.com/blog/product-announcements/10-more-announcements-workspace-at-next-2026
vendor-section: "Google Workspace — AI and Productivity"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/gemini_sparkle_2023_48dp.png
```
Workspace Intelligence is Google's AI layer for Google Workspace that delivers unified, real-time understanding across Workspace apps (Gmail, Docs, Sheets, Slides, Meet, Chat) to power agentic work. It understands semantic relationships within active projects, collaborators, and organizational knowledge to enable AI agents built with Workspace Studio.

## Workspace Marketplace

```yaml
source-url: https://workspace.google.com/marketplace
vendor-section: "Google Workspace — Administration and Compliance"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/admin_2020q4_48dp.png
```
Google Workspace Marketplace is an app store providing thousands of third-party integrations and add-ons for Google Workspace applications. Administrators can approve, restrict, or block marketplace apps via the Admin console, with OAuth-scoped permissions and security reviews for each app.

## Workspace Studio

```yaml
source-url: https://workspace.google.com/blog/product-announcements/10-more-announcements-workspace-at-next-2026
vendor-section: "Google Workspace — AI and Productivity"
available-in-observed: ["Google Workspace"]
candidate-icons:
  - https://www.gstatic.com/images/branding/product/2x/gemini_sparkle_2023_48dp.png
```
Workspace Studio is a no-code AI agent builder within Google Workspace that lets business users create, manage, and share AI agents for automating work across Gmail, Docs, Sheets, Drive, Meet, and Chat by describing automations in plain language without writing code.
