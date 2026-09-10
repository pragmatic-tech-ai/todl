# Locally defined technologies

83 technologies declared across 10 model files in `test_hubspoke_project`.

## ai.todl — AI Workload (10)
- `aiw_azure_openai` — Azure OpenAI
- `aiw_ai_search` — Azure AI Search
- `aiw_apim` — API Management
- `aiw_cosmos_db_chat` — Cosmos DB (chat history)
- `aiw_document_intelligence` — Azure AI Document Intelligence
- `aiw_content_safety` — Azure AI Content Safety
- `aiw_ai_foundry_hub` — Azure AI Foundry Hub
- `aiw_azure_bastion` — Azure Bastion
- `aiw_azure_log_analytics` — Log Analytics
- `aiw_azure_application_insights` — Application Insights

## azure_virtual_desktop.todl — AVD (9)
- `avd_avd_host_pool` — AVD Host Pool
- `avd_avd_workspace` — AVD Workspace
- `avd_avd_app_group` — AVD Application Group
- `avd_fslogix_share` — FSLogix Profile Share
- `avd_azure_files_premium` — Azure Files Premium
- `avd_msix_app_attach` — MSIX App Attach
- `avd_azure_bastion` — Azure Bastion
- `avd_azure_log_analytics` — Log Analytics
- `avd_azure_application_insights` — Application Insights

## azure_vmware_solution.todl — AVS (9)
- `avs_avs_private_cloud` — AVS Private Cloud (SDDC)
- `avs_vsan` — vSAN Datastore
- `avs_nsx_t_edge` — NSX-T Edge
- `avs_hcx_manager` — HCX Manager
- `avs_srm` — VMware Site Recovery Manager
- `avs_expressroute_global_reach` — ExpressRoute Global Reach
- `avs_azure_bastion` — Azure Bastion
- `avs_azure_log_analytics` — Log Analytics
- `avs_azure_application_insights` — Application Insights

## hpc.todl — HPC (9)
- `hpc_cyclecloud` — Azure CycleCloud
- `hpc_hb_series_vm` — HB-series VM (CPU-heavy)
- `hpc_hc_series_vm` — HC-series VM (CFD-tuned)
- `hpc_azure_batch` — Azure Batch
- `hpc_managed_lustre` — Azure Managed Lustre
- `hpc_slurm_scheduler` — Slurm Workload Manager
- `hpc_spot_vmss` — Spot VMSS (interruptible)
- `hpc_azure_bastion` — Azure Bastion
- `hpc_azure_log_analytics` — Log Analytics
- `hpc_azure_application_insights` — Application Insights

## microsoft_fabric.todl — Fabric (11)
- `fab_fabric_capacity` — Microsoft Fabric Capacity
- `fab_onelake` — OneLake
- `fab_fabric_workspace` — Fabric Workspace
- `fab_dataflows_gen2` — Dataflows Gen2
- `fab_fabric_pipeline` — Fabric Data Pipeline
- `fab_eventhouse` — Eventhouse (KQL DB)
- `fab_semantic_model` — Semantic Model
- `fab_on_prem_data_gateway` — On-Premises Data Gateway
- `fab_azure_bastion` — Azure Bastion
- `fab_azure_log_analytics` — Log Analytics
- `fab_azure_application_insights` — Application Insights

## mission_critical.todl — Mission Critical (8)
- `mc_traffic_manager` — Azure Traffic Manager
- `mc_cosmos_db_multi_region` — Cosmos DB (multi-region writes)
- `mc_event_hubs` — Azure Event Hubs
- `mc_aks` — Azure Kubernetes Service
- `mc_chaos_studio` — Azure Chaos Studio
- `mc_azure_bastion` — Azure Bastion
- `mc_azure_log_analytics` — Log Analytics
- `mc_azure_application_insights` — Application Insights

## oracle_iaas.todl — Oracle IaaS (8)
- `orc_oracle_db_vm` — Oracle Database on VM
- `orc_oracle_data_guard` — Oracle Data Guard
- `orc_oracle_asm` — Oracle Automatic Storage Management
- `orc_oracle_goldengate` — Oracle GoldenGate (CDC)
- `orc_oracle_weblogic_vm` — Oracle WebLogic Server on VM
- `orc_azure_bastion` — Azure Bastion
- `orc_azure_log_analytics` — Log Analytics
- `orc_azure_application_insights` — Application Insights

## saas.todl — SaaS (7)
- `saas_apim` — API Management
- `saas_cosmos_db_catalog` — Cosmos DB (Tenant Catalog)
- `saas_event_grid` — Event Grid
- `saas_entra_external_id` — Entra External ID (Customer Identity)
- `saas_azure_bastion` — Azure Bastion
- `saas_azure_log_analytics` — Log Analytics
- `saas_azure_application_insights` — Application Insights

## sap.todl — SAP (10)
- `sap_sap_hana_vm` — SAP HANA VM
- `sap_sap_netweaver_vm` — SAP NetWeaver Application Server VM
- `sap_sap_web_dispatcher` — SAP Web Dispatcher
- `sap_sap_ascs_ers_cluster` — SAP ASCS/ERS Cluster
- `sap_azure_netapp_files` — Azure NetApp Files
- `sap_pacemaker_cluster` — Pacemaker Cluster
- `sap_acss` — Azure Center for SAP solutions
- `sap_azure_bastion` — Azure Bastion
- `sap_azure_log_analytics` — Log Analytics
- `sap_azure_application_insights` — Application Insights

## sustainability.todl — Sustainability (2)
- `sus_azure_log_analytics` — Log Analytics
- `sus_azure_application_insights` — Application Insights

## Observations

- **Duplicated shared services:** `azure_bastion`, `azure_log_analytics`, and `azure_application_insights` are redeclared per model with a workload-specific prefix. Candidate for consolidation into a shared model.
- **Duplicated APIM:** `aiw_apim` and `saas_apim` both wrap API Management.
- **Duplicated Cosmos DB variants:** `aiw_cosmos_db_chat`, `saas_cosmos_db_catalog`, and `mc_cosmos_db_multi_region` are workload-specific facets of the same underlying service.
