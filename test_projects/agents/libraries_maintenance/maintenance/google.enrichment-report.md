# Enrichment report — google

Generated: 2026-05-12T00:00:00Z
Source report: google.discovery-report.md
Apply-updates: on
Icon-dir: C:/Users/Eugene/Projects/architecture-agent/technology_library/google/maintenance/icons-fallback (empty — no user-supplied icons matched)

## Summary

- Locations added: 0 (all 4 locations already existed: gcp, google-workspace, google-ai-studio, firebase)
- Technologies added: 0 (all 156 entries already in library; this run fills wiki stubs and icon files only)
- Technologies skipped (existing, no proposed changes): 156
- Wiki stubs written: 156 (all new; no pre-existing stubs)
- Icon downloads attempted: 0 — [icon-download-failed: Bash not in allowlist; WebFetch also denied]
- Technologies with [low-confidence] flags: 0 (no category or slug decisions made — existing entries read-only per constraint)
- Proposed updates to existing entries (not applied): 0 (applicable-to and available-in are hand-curated; not touched)

## Icon resolution outcome

Both download tools were denied in this session:
- WebFetch: denied (permission error on every call)
- Bash (curl): denied (permission error on every call)

As a result, **all 156 icon paths** referenced in the library (`resources/<slug>.svg`) could not be written. The library entries already contain correct `icon` field values — the files simply do not yet exist on disk. No icon field extensions needed updating (all icons in the discovery report were SVG for GCP, and the library already records `.svg` extensions).

The user can run the following curl script to download all icons after granting Bash access:

```bash
BASE="technology_library/google/resources"
GCP="https://www.gstatic.com/cloud/images/icons"
WS="https://www.gstatic.com/images/branding/product/2x"
GEM="https://www.gstatic.com/lamda/images"

# GCP SVG icons — unique source files (shared icons used for multiple slugs)
curl -L -sS -o "$BASE/compute-engine.svg"               "$GCP/icon_compute_engine.svg"
curl -L -sS -o "$BASE/ai-hypercomputer.svg"             "$GCP/icon_compute_engine.svg"
curl -L -sS -o "$BASE/alloydb-for-postgresql.svg"       "$GCP/icon_alloydb.svg"
curl -L -sS -o "$BASE/alloydb-omni.svg"                 "$GCP/icon_alloydb.svg"
curl -L -sS -o "$BASE/bigquery.svg"                     "$GCP/icon_bigquery.svg"
curl -L -sS -o "$BASE/analytics-hub.svg"                "$GCP/icon_bigquery.svg"
curl -L -sS -o "$BASE/bigquery-data-transfer-service.svg" "$GCP/icon_bigquery.svg"
curl -L -sS -o "$BASE/bigquery-ml.svg"                  "$GCP/icon_bigquery.svg"
curl -L -sS -o "$BASE/app-engine.svg"                   "$GCP/icon_app_engine.svg"
curl -L -sS -o "$BASE/apigee-api-management.svg"        "$GCP/icon_apigee.svg"
curl -L -sS -o "$BASE/api-gateway.svg"                  "$GCP/icon_api_gateway.svg"
curl -L -sS -o "$BASE/application-integration.svg"      "$GCP/icon_application_integration.svg"
curl -L -sS -o "$BASE/artifact-registry.svg"            "$GCP/icon_artifact_registry.svg"
curl -L -sS -o "$BASE/assured-workloads.svg"            "$GCP/icon_assured_workloads.svg"
curl -L -sS -o "$BASE/bare-metal-solution.svg"          "$GCP/icon_bare_metal.svg"
curl -L -sS -o "$BASE/binary-authorization.svg"         "$GCP/icon_binary_authorization.svg"
curl -L -sS -o "$BASE/certificate-manager.svg"          "$GCP/icon_certificate_manager.svg"
curl -L -sS -o "$BASE/chronicle-siem.svg"               "$GCP/icon_chronicle.svg"
curl -L -sS -o "$BASE/chronicle-soar.svg"               "$GCP/icon_chronicle.svg"
curl -L -sS -o "$BASE/google-security-operations.svg"   "$GCP/icon_chronicle.svg"
curl -L -sS -o "$BASE/cloud-armor.svg"                  "$GCP/icon_cloud_armor.svg"
curl -L -sS -o "$BASE/cloud-armor-enterprise.svg"       "$GCP/icon_cloud_armor.svg"
curl -L -sS -o "$BASE/cloud-asset-inventory.svg"        "$GCP/icon_cloud_asset_inventory.svg"
curl -L -sS -o "$BASE/cloud-batch.svg"                  "$GCP/icon_batch.svg"
curl -L -sS -o "$BASE/cloud-bigtable.svg"               "$GCP/icon_bigtable.svg"
curl -L -sS -o "$BASE/cloud-billing.svg"                "$GCP/icon_billing.svg"
curl -L -sS -o "$BASE/cloud-build.svg"                  "$GCP/icon_cloud_build.svg"
curl -L -sS -o "$BASE/cloud-cdn.svg"                    "$GCP/icon_cloud_cdn.svg"
curl -L -sS -o "$BASE/cloud-composer.svg"               "$GCP/icon_cloud_composer.svg"
curl -L -sS -o "$BASE/cloud-data-fusion.svg"            "$GCP/icon_data_fusion.svg"
curl -L -sS -o "$BASE/cloud-deploy.svg"                 "$GCP/icon_cloud_deploy.svg"
curl -L -sS -o "$BASE/cloud-dns.svg"                    "$GCP/icon_cloud_dns.svg"
curl -L -sS -o "$BASE/cloud-endpoints.svg"              "$GCP/icon_cloud_endpoints.svg"
curl -L -sS -o "$BASE/cloud-firewall.svg"               "$GCP/icon_cloud_firewall.svg"
curl -L -sS -o "$BASE/cloud-functions.svg"              "$GCP/icon_cloud_functions.svg"
curl -L -sS -o "$BASE/cloud-healthcare-api.svg"         "$GCP/icon_healthcare_api.svg"
curl -L -sS -o "$BASE/cloud-identity.svg"               "$GCP/icon_cloud_identity.svg"
curl -L -sS -o "$BASE/cloud-identity-aware-proxy.svg"   "$GCP/icon_iap.svg"
curl -L -sS -o "$BASE/cloud-ids.svg"                    "$GCP/icon_cloud_ids.svg"
curl -L -sS -o "$BASE/cloud-interconnect.svg"           "$GCP/icon_cloud_interconnect.svg"
curl -L -sS -o "$BASE/cloud-kms.svg"                    "$GCP/icon_kms.svg"
curl -L -sS -o "$BASE/cloud-load-balancing.svg"         "$GCP/icon_cloud_load_balancing.svg"
curl -L -sS -o "$BASE/cloud-logging.svg"                "$GCP/icon_logging.svg"
curl -L -sS -o "$BASE/cloud-monitoring.svg"             "$GCP/icon_monitoring.svg"
curl -L -sS -o "$BASE/cloud-nat.svg"                    "$GCP/icon_cloud_nat.svg"
curl -L -sS -o "$BASE/cloud-profiler.svg"               "$GCP/icon_profiler.svg"
curl -L -sS -o "$BASE/cloud-router.svg"                 "$GCP/icon_cloud_router.svg"
curl -L -sS -o "$BASE/cloud-run.svg"                    "$GCP/icon_cloud_run.svg"
curl -L -sS -o "$BASE/cloud-security-command-center.svg" "$GCP/icon_security_command_center.svg"
curl -L -sS -o "$BASE/cloud-spanner.svg"                "$GCP/icon_spanner.svg"
curl -L -sS -o "$BASE/cloud-sql.svg"                    "$GCP/icon_cloud_sql.svg"
curl -L -sS -o "$BASE/cloud-storage.svg"                "$GCP/icon_cloud_storage.svg"
curl -L -sS -o "$BASE/cloud-tasks.svg"                  "$GCP/icon_cloud_tasks.svg"
curl -L -sS -o "$BASE/cloud-tpu.svg"                    "$GCP/icon_tpu.svg"
curl -L -sS -o "$BASE/cloud-trace.svg"                  "$GCP/icon_trace.svg"
curl -L -sS -o "$BASE/cloud-vpn.svg"                    "$GCP/icon_cloud_vpn.svg"
curl -L -sS -o "$BASE/cloud-workstations.svg"           "$GCP/icon_cloud_workstations.svg"
curl -L -sS -o "$BASE/colab-enterprise.svg"             "$GCP/icon_colab.svg"
curl -L -sS -o "$BASE/confidential-computing.svg"       "$GCP/icon_confidential_computing.svg"
curl -L -sS -o "$BASE/contact-center-ai.svg"            "$GCP/icon_contact_center_ai.svg"
curl -L -sS -o "$BASE/cross-cloud-interconnect.svg"     "$GCP/icon_cloud_interconnect.svg"
curl -L -sS -o "$BASE/data-studio.svg"                  "$GCP/icon_looker_studio.svg"
curl -L -sS -o "$BASE/database-migration-service.svg"   "$GCP/icon_database_migration.svg"
curl -L -sS -o "$BASE/dataflow.svg"                     "$GCP/icon_dataflow.svg"
curl -L -sS -o "$BASE/dataform.svg"                     "$GCP/icon_dataform.svg"
curl -L -sS -o "$BASE/dataproc.svg"                     "$GCP/icon_dataproc.svg"
curl -L -sS -o "$BASE/datastream.svg"                   "$GCP/icon_datastream.svg"
curl -L -sS -o "$BASE/document-ai.svg"                  "$GCP/icon_document_ai.svg"
curl -L -sS -o "$BASE/earth-engine.svg"                 "$GCP/icon_earth_engine.svg"
curl -L -sS -o "$BASE/error-reporting.svg"              "$GCP/icon_error_reporting.svg"
curl -L -sS -o "$BASE/eventarc.svg"                     "$GCP/icon_eventarc.svg"
curl -L -sS -o "$BASE/filestore.svg"                    "$GCP/icon_filestore.svg"
curl -L -sS -o "$BASE/firestore.svg"                    "$GCP/icon_firestore.svg"
curl -L -sS -o "$BASE/gemini-enterprise-agent-platform.svg" "$GCP/icon_gemini.svg"
curl -L -sS -o "$BASE/gke.svg"                          "$GCP/icon_container_engine.svg"
curl -L -sS -o "$BASE/gke-enterprise.svg"               "$GCP/icon_container_engine.svg"
curl -L -sS -o "$BASE/google-distributed-cloud.svg"     "$GCP/icon_distributed_cloud.svg"
curl -L -sS -o "$BASE/google-migration-center.svg"      "$GCP/icon_migration_center.svg"
curl -L -sS -o "$BASE/integration-connectors.svg"       "$GCP/icon_integration_connectors.svg"
curl -L -sS -o "$BASE/knowledge-catalog.svg"            "$GCP/icon_dataplex.svg"
curl -L -sS -o "$BASE/local-ssd.svg"                    "$GCP/icon_persistent_disk.svg"
curl -L -sS -o "$BASE/looker.svg"                       "$GCP/icon_looker.svg"
curl -L -sS -o "$BASE/managed-lustre.svg"               "$GCP/icon_filestore.svg"
curl -L -sS -o "$BASE/mandiant-threat-intelligence.svg" "$GCP/icon_mandiant.svg"
curl -L -sS -o "$BASE/memorystore.svg"                  "$GCP/icon_memorystore.svg"
curl -L -sS -o "$BASE/migrate-to-containers.svg"        "$GCP/icon_migrate_to_containers.svg"
curl -L -sS -o "$BASE/migrate-to-virtual-machines.svg"  "$GCP/icon_compute_engine.svg"
curl -L -sS -o "$BASE/model-garden.svg"                 "$GCP/icon_gemini.svg"
curl -L -sS -o "$BASE/natural-language-ai.svg"          "$GCP/icon_natural_language.svg"
curl -L -sS -o "$BASE/netapp-volumes.svg"               "$GCP/icon_filestore.svg"
curl -L -sS -o "$BASE/network-connectivity-center.svg"  "$GCP/icon_network_connectivity_center.svg"
curl -L -sS -o "$BASE/parallelstore.svg"                "$GCP/icon_filestore.svg"
curl -L -sS -o "$BASE/persistent-disk.svg"              "$GCP/icon_persistent_disk.svg"
curl -L -sS -o "$BASE/private-service-connect.svg"      "$GCP/icon_private_service_connect.svg"
curl -L -sS -o "$BASE/pubsub.svg"                       "$GCP/icon_pubsub.svg"
curl -L -sS -o "$BASE/recaptcha-enterprise.svg"         "$GCP/icon_recaptcha.svg"
curl -L -sS -o "$BASE/recommendations-ai.svg"           "$GCP/icon_recommendations_ai.svg"
curl -L -sS -o "$BASE/resource-manager.svg"             "$GCP/icon_resource_manager.svg"
curl -L -sS -o "$BASE/secret-manager.svg"               "$GCP/icon_secret_manager.svg"
curl -L -sS -o "$BASE/secure-source-manager.svg"        "$GCP/icon_cloud_source_repositories.svg"
curl -L -sS -o "$BASE/service-directory.svg"            "$GCP/icon_service_directory.svg"
curl -L -sS -o "$BASE/spanner-omni.svg"                 "$GCP/icon_spanner.svg"
curl -L -sS -o "$BASE/speech-to-text.svg"               "$GCP/icon_speech_to_text.svg"
curl -L -sS -o "$BASE/storage-transfer-service.svg"     "$GCP/icon_storage_transfer.svg"
curl -L -sS -o "$BASE/text-to-speech.svg"               "$GCP/icon_text_to_speech.svg"
curl -L -sS -o "$BASE/traffic-director.svg"             "$GCP/icon_traffic_director.svg"
curl -L -sS -o "$BASE/transfer-appliance.svg"           "$GCP/icon_transfer_appliance.svg"
curl -L -sS -o "$BASE/translation-ai.svg"               "$GCP/icon_translation.svg"
curl -L -sS -o "$BASE/vertex-ai-workbench.svg"          "$GCP/icon_vertex_ai.svg"
curl -L -sS -o "$BASE/video-intelligence-api.svg"       "$GCP/icon_video_intelligence.svg"
curl -L -sS -o "$BASE/virtual-private-cloud.svg"        "$GCP/icon_vpc.svg"
curl -L -sS -o "$BASE/vision-ai.svg"                    "$GCP/icon_vision.svg"
curl -L -sS -o "$BASE/vpc-service-controls.svg"         "$GCP/icon_vpc_service_controls.svg"
curl -L -sS -o "$BASE/web-risk-api.svg"                 "$GCP/icon_web_risk.svg"
curl -L -sS -o "$BASE/workflows.svg"                    "$GCP/icon_workflows.svg"

# Gemini / AI sparkle SVG
curl -L -sS -o "$BASE/gemini-api.svg"  "$GEM/gemini_sparkle_v002_d4735304ff6292a690345.svg"
curl -L -sS -o "$BASE/gemma.svg"       "$GEM/gemini_sparkle_v002_d4735304ff6292a690345.svg"

# Google Workspace PNG icons (binary — saved as .png)
# NOTE: library entries reference .svg; rename/update icon field if keeping as .png
curl -L -sS -o "$BASE/google-calendar.png"  "$WS/calendar_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-chat.png"      "$WS/chat_2023_48dp.png"
curl -L -sS -o "$BASE/google-docs.png"      "$WS/docs_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-drive.png"     "$WS/drive_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-forms.png"     "$WS/forms_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-keep.png"      "$WS/keep_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-meet.png"      "$WS/meet_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-sheets.png"    "$WS/sheets_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-sites.png"     "$WS/sites_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-slides.png"    "$WS/slides_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-tasks.png"     "$WS/tasks_google_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-vault.png"     "$WS/vault_2020q4_48dp.png"
curl -L -sS -o "$BASE/google-vids.png"      "$WS/vids_2024_48dp.png"
curl -L -sS -o "$BASE/google-voice.png"     "$WS/voice_2023_48dp.png"
curl -L -sS -o "$BASE/gmail.png"            "$WS/gmail_2020q4_48dp.png"
curl -L -sS -o "$BASE/appsheet.png"         "$WS/appsheet_2023_48dp.png"
curl -L -sS -o "$BASE/workspace-intelligence.png" "$WS/gemini_sparkle_2023_48dp.png"
curl -L -sS -o "$BASE/workspace-studio.png"       "$WS/gemini_sparkle_2023_48dp.png"
curl -L -sS -o "$BASE/notebooklm.svg"       "$GEM/gemini_sparkle_v002_d4735304ff6292a690345.svg"
curl -L -sS -o "$BASE/google-maps-platform.png"   "$WS/maps_2020q4_48dp.png"

# Firebase PNG icons (all share the same lockup.png)
FIREBASE_LOCKUP="https://www.gstatic.com/devrel-devsite/prod/v84e6f6a61298bbae5bb110096aaa35ab221a8d6a5c7c8ed19b0c9daabe13fea/firebase/images/lockup.png"
for slug in firebase-ab-testing firebase-ai-logic firebase-app-check firebase-app-distribution \
            firebase-app-hosting firebase-authentication firebase-cloud-messaging firebase-crashlytics \
            firebase-data-connect firebase-genkit firebase-hosting firebase-in-app-messaging \
            firebase-ml firebase-performance-monitoring firebase-realtime-database firebase-remote-config \
            firebase-test-lab google-analytics-for-firebase; do
  curl -L -sS -o "$BASE/${slug}.png" "$FIREBASE_LOCKUP"
done

# workspace-endpoint-management shares the admin icon
curl -L -sS -o "$BASE/workspace-endpoint-management.png" "$WS/admin_2020q4_48dp.png"
```

**Icon extension note for Workspace / Firebase icons:** The library entries reference `resources/<slug>.svg` but the discovery-report candidates are all PNG for Workspace and Firebase entries. After running the curl script above, the `.png` files will exist but the library `icon` field still says `.svg`. You will need to either:
1. Run the enricher again with `--apply-updates` once Bash is available to update the extension, or
2. Manually update the ~38 Workspace + Firebase entries from `.svg` to `.png` in the library file.

The GCP entries (via `gstatic.com/cloud/images/icons/`) are true SVGs — those paths are correct as-is.

## Technologies

All 156 technologies were pre-existing in the library. The table below records the icon source mapping from the discovery report for audit purposes.

### GCP — Compute

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| ai-hypercomputer | resources/ai-hypercomputer.svg | icon_compute_engine.svg | Shared icon — no dedicated AI Hypercomputer icon in GCP set |
| app-engine | resources/app-engine.svg | icon_app_engine.svg | |
| bare-metal-solution | resources/bare-metal-solution.svg | icon_bare_metal.svg | |
| cloud-batch | resources/cloud-batch.svg | icon_batch.svg | |
| cloud-functions | resources/cloud-functions.svg | icon_cloud_functions.svg | |
| cloud-run | resources/cloud-run.svg | icon_cloud_run.svg | |
| cloud-tpu | resources/cloud-tpu.svg | icon_tpu.svg | |
| compute-engine | resources/compute-engine.svg | icon_compute_engine.svg | |
| confidential-computing | resources/confidential-computing.svg | icon_confidential_computing.svg | |
| google-distributed-cloud | resources/google-distributed-cloud.svg | icon_distributed_cloud.svg | |

### GCP — Containers

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| gke | resources/gke.svg | icon_container_engine.svg | |
| gke-enterprise | resources/gke-enterprise.svg | icon_container_engine.svg | Shared icon with gke |

### GCP — Storage

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| cloud-storage | resources/cloud-storage.svg | icon_cloud_storage.svg | |
| filestore | resources/filestore.svg | icon_filestore.svg | |
| local-ssd | resources/local-ssd.svg | icon_persistent_disk.svg | Shared icon — no dedicated Local SSD icon |
| managed-lustre | resources/managed-lustre.svg | icon_filestore.svg | Shared filestore icon — new service, no dedicated icon yet |
| netapp-volumes | resources/netapp-volumes.svg | icon_filestore.svg | Shared filestore icon |
| parallelstore | resources/parallelstore.svg | icon_filestore.svg | Shared filestore icon |
| persistent-disk | resources/persistent-disk.svg | icon_persistent_disk.svg | |
| storage-transfer-service | resources/storage-transfer-service.svg | icon_storage_transfer.svg | |

### GCP — Databases

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| alloydb-for-postgresql | resources/alloydb-for-postgresql.svg | icon_alloydb.svg | |
| alloydb-omni | resources/alloydb-omni.svg | icon_alloydb.svg | Shared with alloydb-for-postgresql |
| cloud-bigtable | resources/cloud-bigtable.svg | icon_bigtable.svg | |
| cloud-spanner | resources/cloud-spanner.svg | icon_spanner.svg | |
| cloud-sql | resources/cloud-sql.svg | icon_cloud_sql.svg | |
| database-migration-service | resources/database-migration-service.svg | icon_database_migration.svg | |
| firestore | resources/firestore.svg | icon_firestore.svg | |
| memorystore | resources/memorystore.svg | icon_memorystore.svg | |
| spanner-omni | resources/spanner-omni.svg | icon_spanner.svg | Shared with cloud-spanner |

### GCP — Networking

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| cloud-armor | resources/cloud-armor.svg | icon_cloud_armor.svg | |
| cloud-armor-enterprise | resources/cloud-armor-enterprise.svg | icon_cloud_armor.svg | Shared with cloud-armor |
| cloud-cdn | resources/cloud-cdn.svg | icon_cloud_cdn.svg | |
| cloud-dns | resources/cloud-dns.svg | icon_cloud_dns.svg | |
| cloud-firewall | resources/cloud-firewall.svg | icon_cloud_firewall.svg | |
| cloud-interconnect | resources/cloud-interconnect.svg | icon_cloud_interconnect.svg | |
| cloud-load-balancing | resources/cloud-load-balancing.svg | icon_cloud_load_balancing.svg | |
| cloud-nat | resources/cloud-nat.svg | icon_cloud_nat.svg | |
| cloud-router | resources/cloud-router.svg | icon_cloud_router.svg | |
| cloud-vpn | resources/cloud-vpn.svg | icon_cloud_vpn.svg | |
| cross-cloud-interconnect | resources/cross-cloud-interconnect.svg | icon_cloud_interconnect.svg | Shared with cloud-interconnect |
| network-connectivity-center | resources/network-connectivity-center.svg | icon_network_connectivity_center.svg | |
| private-service-connect | resources/private-service-connect.svg | icon_private_service_connect.svg | |
| service-directory | resources/service-directory.svg | icon_service_directory.svg | |
| traffic-director | resources/traffic-director.svg | icon_traffic_director.svg | |
| virtual-private-cloud | resources/virtual-private-cloud.svg | icon_vpc.svg | |

### GCP — Data Analytics

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| analytics-hub | resources/analytics-hub.svg | icon_bigquery.svg | Shared BigQuery icon — no dedicated Analytics Hub icon |
| bigquery | resources/bigquery.svg | icon_bigquery.svg | |
| bigquery-data-transfer-service | resources/bigquery-data-transfer-service.svg | icon_bigquery.svg | Shared BigQuery icon |
| bigquery-ml | resources/bigquery-ml.svg | icon_bigquery.svg | Shared BigQuery icon |
| cloud-composer | resources/cloud-composer.svg | icon_cloud_composer.svg | |
| cloud-data-fusion | resources/cloud-data-fusion.svg | icon_data_fusion.svg | |
| data-studio | resources/data-studio.svg | icon_looker_studio.svg | |
| dataflow | resources/dataflow.svg | icon_dataflow.svg | |
| dataform | resources/dataform.svg | icon_dataform.svg | |
| dataproc | resources/dataproc.svg | icon_dataproc.svg | |
| datastream | resources/datastream.svg | icon_datastream.svg | |
| knowledge-catalog | resources/knowledge-catalog.svg | icon_dataplex.svg | Dataplex icon for Knowledge Catalog (formerly Dataplex) |
| looker | resources/looker.svg | icon_looker.svg | |
| pubsub | resources/pubsub.svg | icon_pubsub.svg | |

### GCP — AI / ML

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| colab-enterprise | resources/colab-enterprise.svg | icon_colab.svg | |
| contact-center-ai | resources/contact-center-ai.svg | icon_contact_center_ai.svg | |
| document-ai | resources/document-ai.svg | icon_document_ai.svg | |
| gemini-enterprise-agent-platform | resources/gemini-enterprise-agent-platform.svg | icon_gemini.svg | |
| model-garden | resources/model-garden.svg | icon_gemini.svg | Shared with gemini-enterprise-agent-platform |
| natural-language-ai | resources/natural-language-ai.svg | icon_natural_language.svg | |
| recommendations-ai | resources/recommendations-ai.svg | icon_recommendations_ai.svg | |
| speech-to-text | resources/speech-to-text.svg | icon_speech_to_text.svg | |
| text-to-speech | resources/text-to-speech.svg | icon_text_to_speech.svg | |
| translation-ai | resources/translation-ai.svg | icon_translation.svg | |
| vertex-ai-workbench | resources/vertex-ai-workbench.svg | icon_vertex_ai.svg | |
| video-intelligence-api | resources/video-intelligence-api.svg | icon_video_intelligence.svg | |
| vision-ai | resources/vision-ai.svg | icon_vision.svg | |

### Google AI for Developers

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| gemini-api | resources/gemini-api.svg | gemini_sparkle_v002_d4735304ff6292a690345.svg | Gemini sparkle SVG |
| gemma | resources/gemma.svg | gemini_sparkle_v002_d4735304ff6292a690345.svg | Shared Gemini sparkle |

### GCP — Security

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| assured-workloads | resources/assured-workloads.svg | icon_assured_workloads.svg | |
| binary-authorization | resources/binary-authorization.svg | icon_binary_authorization.svg | |
| certificate-manager | resources/certificate-manager.svg | icon_certificate_manager.svg | |
| chronicle-siem | resources/chronicle-siem.svg | icon_chronicle.svg | |
| chronicle-soar | resources/chronicle-soar.svg | icon_chronicle.svg | Shared with chronicle-siem |
| cloud-ids | resources/cloud-ids.svg | icon_cloud_ids.svg | |
| cloud-kms | resources/cloud-kms.svg | icon_kms.svg | |
| cloud-security-command-center | resources/cloud-security-command-center.svg | icon_security_command_center.svg | |
| google-security-operations | resources/google-security-operations.svg | icon_chronicle.svg | Shared chronicle icon |
| mandiant-threat-intelligence | resources/mandiant-threat-intelligence.svg | icon_mandiant.svg | |
| recaptcha-enterprise | resources/recaptcha-enterprise.svg | icon_recaptcha.svg | |
| secret-manager | resources/secret-manager.svg | icon_secret_manager.svg | |
| vpc-service-controls | resources/vpc-service-controls.svg | icon_vpc_service_controls.svg | |
| web-risk-api | resources/web-risk-api.svg | icon_web_risk.svg | |

### GCP — Identity

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| cloud-identity | resources/cloud-identity.svg | icon_cloud_identity.svg | |
| cloud-identity-aware-proxy | resources/cloud-identity-aware-proxy.svg | icon_iap.svg | |

### GCP — Developer / DevOps

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| artifact-registry | resources/artifact-registry.svg | icon_artifact_registry.svg | |
| cloud-build | resources/cloud-build.svg | icon_cloud_build.svg | |
| cloud-deploy | resources/cloud-deploy.svg | icon_cloud_deploy.svg | |
| cloud-workstations | resources/cloud-workstations.svg | icon_cloud_workstations.svg | |
| secure-source-manager | resources/secure-source-manager.svg | icon_cloud_source_repositories.svg | Uses Cloud Source Repos icon |

### GCP — Management / Observability

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| cloud-asset-inventory | resources/cloud-asset-inventory.svg | icon_cloud_asset_inventory.svg | |
| cloud-billing | resources/cloud-billing.svg | icon_billing.svg | |
| cloud-logging | resources/cloud-logging.svg | icon_logging.svg | |
| cloud-monitoring | resources/cloud-monitoring.svg | icon_monitoring.svg | |
| cloud-profiler | resources/cloud-profiler.svg | icon_profiler.svg | |
| cloud-trace | resources/cloud-trace.svg | icon_trace.svg | |
| error-reporting | resources/error-reporting.svg | icon_error_reporting.svg | |
| resource-manager | resources/resource-manager.svg | icon_resource_manager.svg | |

### GCP — Integration / API

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| api-gateway | resources/api-gateway.svg | icon_api_gateway.svg | |
| apigee-api-management | resources/apigee-api-management.svg | icon_apigee.svg | |
| application-integration | resources/application-integration.svg | icon_application_integration.svg | |
| cloud-endpoints | resources/cloud-endpoints.svg | icon_cloud_endpoints.svg | |
| cloud-tasks | resources/cloud-tasks.svg | icon_cloud_tasks.svg | |
| eventarc | resources/eventarc.svg | icon_eventarc.svg | |
| integration-connectors | resources/integration-connectors.svg | icon_integration_connectors.svg | |
| workflows | resources/workflows.svg | icon_workflows.svg | |

### GCP — Migration

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| google-migration-center | resources/google-migration-center.svg | icon_migration_center.svg | |
| migrate-to-containers | resources/migrate-to-containers.svg | icon_migrate_to_containers.svg | |
| migrate-to-virtual-machines | resources/migrate-to-virtual-machines.svg | icon_compute_engine.svg | Shared compute icon |
| transfer-appliance | resources/transfer-appliance.svg | icon_transfer_appliance.svg | |

### GCP — Specialized

| slug | icon path in library | discovery-report candidate | notes |
|------|---------------------|---------------------------|-------|
| cloud-healthcare-api | resources/cloud-healthcare-api.svg | icon_healthcare_api.svg | |
| earth-engine | resources/earth-engine.svg | icon_earth_engine.svg | |
| google-maps-platform | resources/google-maps-platform.svg | icon_maps_2020q4 (PNG) | [low-confidence on icon quality] PNG only; library records .svg extension — update to .png after download |

### Firebase (18 entries)

All Firebase entries share a single lockup PNG from the discovery report. This is a generic Firebase brand logo, not per-product icons. All 18 are flagged below:

| slug | library icon path | notes |
|------|------------------|-------|
| firebase-ab-testing | resources/firebase-ab-testing.svg | [no-per-product-icon] — generic Firebase lockup.png only; library records .svg |
| firebase-ai-logic | resources/firebase-ai-logic.svg | same |
| firebase-app-check | resources/firebase-app-check.svg | same |
| firebase-app-distribution | resources/firebase-app-distribution.svg | same |
| firebase-app-hosting | resources/firebase-app-hosting.svg | same |
| firebase-authentication | resources/firebase-authentication.svg | same |
| firebase-cloud-messaging | resources/firebase-cloud-messaging.svg | same |
| firebase-crashlytics | resources/firebase-crashlytics.svg | same |
| firebase-data-connect | resources/firebase-data-connect.svg | same |
| firebase-genkit | resources/firebase-genkit.svg | same |
| firebase-hosting | resources/firebase-hosting.svg | same |
| firebase-in-app-messaging | resources/firebase-in-app-messaging.svg | same |
| firebase-ml | resources/firebase-ml.svg | same |
| firebase-performance-monitoring | resources/firebase-performance-monitoring.svg | same |
| firebase-realtime-database | resources/firebase-realtime-database.svg | same |
| firebase-remote-config | resources/firebase-remote-config.svg | same |
| firebase-test-lab | resources/firebase-test-lab.svg | same |
| google-analytics-for-firebase | resources/google-analytics-for-firebase.svg | same |

Recommendation: download lockup.png as a shared fallback and update all 18 library entries from `.svg` to `.png`, or use a web search to locate individual per-product Firebase icons (Firebase does publish product-specific icons in their brand kit).

### Google Workspace (20 entries)

| slug | library icon path | discovery-report candidate | notes |
|------|------------------|---------------------------|-------|
| google-docs | resources/google-docs.svg | docs_2020q4_48dp.png | [extension-mismatch] library .svg, actual PNG |
| google-forms | resources/google-forms.svg | forms_2020q4_48dp.png | same |
| google-sheets | resources/google-sheets.svg | sheets_2020q4_48dp.png | same |
| google-sites | resources/google-sites.svg | sites_2020q4_48dp.png | same |
| google-slides | resources/google-slides.svg | slides_2020q4_48dp.png | same |
| google-vids | resources/google-vids.svg | vids_2024_48dp.png | same |
| gmail | resources/gmail.svg | gmail_2020q4_48dp.png | same |
| google-calendar | resources/google-calendar.svg | calendar_2020q4_48dp.png | same |
| google-chat | resources/google-chat.svg | chat_2023_48dp.png | same |
| google-meet | resources/google-meet.svg | meet_2020q4_48dp.png | same |
| google-voice | resources/google-voice.svg | voice_2023_48dp.png | same |
| google-drive | resources/google-drive.svg | drive_2020q4_48dp.png | same |
| google-keep | resources/google-keep.svg | keep_2020q4_48dp.png | same |
| google-tasks | resources/google-tasks.svg | tasks_google_2020q4_48dp.png | same |
| google-vault | resources/google-vault.svg | vault_2020q4_48dp.png | same |
| workspace-endpoint-management | resources/workspace-endpoint-management.svg | admin_2020q4_48dp.png | [low-confidence on icon quality] Admin icon is generic; no per-product Endpoint Management icon in discovery report |
| appsheet | resources/appsheet.svg | appsheet_2023_48dp.png | same extension issue |
| notebooklm | resources/notebooklm.svg | gemini_sparkle_v002 (SVG) | Extension correct — Gemini sparkle SVG |
| workspace-intelligence | resources/workspace-intelligence.svg | gemini_sparkle_2023_48dp.png | [extension-mismatch] different sparkle asset, PNG |
| workspace-studio | resources/workspace-studio.svg | gemini_sparkle_2023_48dp.png | same |

## Discovery-report entries not in library (skipped)

The following entries appear in the discovery report but were not present as library slugs and were not emitted (per constraint — no new entries):

| Discovery-report heading | Reason skipped |
|-------------------------|----------------|
| Cloud Code | Not in library — dropped during CSV curation |
| Cloud Shell | Not in library — dropped during CSV curation |
| Cloud Datastore | Not in library — dropped during CSV curation (superseded by Firestore) |
| Firebase Extensions | Not in library — dropped during CSV curation |
| Firebase Studio | Not in library — dropped during CSV curation |
| Gemini Code Assist | Not in library — dropped during CSV curation |
| Google AI Studio (as standalone entry) | Not in library as own entry — available as location `google-ai-studio`; Gemini API entry covers the API surface |
| Workspace Admin | Not in library — dropped during CSV curation |
| Workspace Marketplace | Not in library — dropped during CSV curation |

(Discovery report had 183 total but library has 156; difference of 27 is partly from the above drops plus section header overcounting.)

## Proposed updates to existing entries

None. Per run constraint: applicable-to, available-in, label, and wiki fields on existing entries are not touched. The only field updates needed (icon extension .svg → .png for 38 Workspace + Firebase entries) are flagged above but NOT applied — they require the icon files to exist on disk first and a follow-up run with --apply-updates.
