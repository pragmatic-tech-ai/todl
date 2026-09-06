import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";

/** The Setup page: registry connection + auth token (stored, or an env-var pick). */
export class SetupVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(SetupVM, "Title", "Setup", MetaData.None);
  static RegistryKey = MuralBase.RegisterProperty<string>(SetupVM, "Registry", "", MetaData.None);
  static ScopeKey = MuralBase.RegisterProperty<string>(SetupVM, "Scope", "", MetaData.None);
  static OrgKey = MuralBase.RegisterProperty<string>(SetupVM, "Org", "", MetaData.None);
  static TokenInputKey = MuralBase.RegisterProperty<string>(SetupVM, "TokenInput", "", MetaData.None);
  static EnvVarsKey = MuralBase.RegisterProperty<string[]>(SetupVM, "EnvVars", [], MetaData.None);
  static SelectedEnvVarKey = MuralBase.RegisterProperty<string | undefined>(SetupVM, "SelectedEnvVar", undefined, MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(SetupVM, "Status", "", MetaData.None);
  static SaveSettingsKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "SaveSettings", undefined, MetaData.None);
  static SaveTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "SaveToken", undefined, MetaData.None);
  static UseEnvKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "UseEnv", undefined, MetaData.None);
  static ClearTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "ClearToken", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(SetupVM.TitleKey); }
  get Registry(): string { return this.get_property_value(SetupVM.RegistryKey); }
  get Scope(): string { return this.get_property_value(SetupVM.ScopeKey); }
  get Org(): string { return this.get_property_value(SetupVM.OrgKey); }
  get TokenInput(): string { return this.get_property_value(SetupVM.TokenInputKey); }
  get EnvVars(): string[] { return this.get_property_value(SetupVM.EnvVarsKey); }
  get SelectedEnvVar(): string | undefined { return this.get_property_value(SetupVM.SelectedEnvVarKey); }
  get Status(): string { return this.get_property_value(SetupVM.StatusKey); }
  get SaveSettings(): ICommand | undefined { return this.get_property_value(SetupVM.SaveSettingsKey); }
  get SaveToken(): ICommand | undefined { return this.get_property_value(SetupVM.SaveTokenKey); }
  get UseEnv(): ICommand | undefined { return this.get_property_value(SetupVM.UseEnvKey); }
  get ClearToken(): ICommand | undefined { return this.get_property_value(SetupVM.ClearTokenKey); }

  constructor(private readonly client: RegistryClient) {
    super();
    this.set_property_value(SetupVM.SaveSettingsKey, new RelayCommand(() => void this.saveSettings()));
    this.set_property_value(SetupVM.SaveTokenKey, new RelayCommand(() => void this.saveToken()));
    this.set_property_value(SetupVM.UseEnvKey, new RelayCommand(() => void this.useEnv()));
    this.set_property_value(SetupVM.ClearTokenKey, new RelayCommand(() => void this.clearToken()));
  }

  async load(): Promise<void> {
    const [config, envVars] = await Promise.all([this.client.getConfig(), this.client.listEnvVars()]);
    this.set_property_value(SetupVM.RegistryKey, config.registry);
    this.set_property_value(SetupVM.ScopeKey, config.scope);
    this.set_property_value(SetupVM.OrgKey, config.org);
    this.set_property_value(SetupVM.EnvVarsKey, envVars);
    if (config.tokenEnvVar) this.set_property_value(SetupVM.SelectedEnvVarKey, config.tokenEnvVar);
    this.refreshStatus(config.tokenSource, config.tokenEnvVar, config.hasToken);
  }

  private refreshStatus(source: string, envVar: string, hasToken: boolean): void {
    const where = source === "env" ? `env var "${envVar || "(none)"}"` : "stored token";
    this.set_property_value(SetupVM.StatusKey, `Token source: ${where} — ${hasToken ? "resolved ✓" : "not set ✗"}`);
  }

  private async saveSettings(): Promise<void> {
    await this.client.setSettings({ registry: this.Registry, scope: this.Scope, org: this.Org });
    await this.load();
  }

  private async saveToken(): Promise<void> {
    await this.client.setStoredToken(this.TokenInput);
    this.set_property_value(SetupVM.TokenInputKey, "");
    await this.load();
  }

  private async useEnv(): Promise<void> {
    if (!this.SelectedEnvVar) return;
    await this.client.useEnvToken(this.SelectedEnvVar);
    await this.load();
  }

  private async clearToken(): Promise<void> {
    await this.client.setStoredToken("");
    await this.load();
  }
}
