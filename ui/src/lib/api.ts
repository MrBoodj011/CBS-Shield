import { invoke } from "@tauri-apps/api/core";

import type {
  AppInfo,
  ClamavInstallResult,
  DashboardStats,
  EngineStatus,
  ExportResult,
  FirewallConnections,
  FirewallObservation,
  FirewallSnapshotExport,
  FirewallSnapshotInfo,
  FirewallSnapshotVerification,
  NetmonSnapshotPayload,
  NetmonSnapshotRecord,
  ProvisioningStatus,
  QuarantineRecord,
  ResolvedTargets,
  RuleManagementStatus,
  ScanDetails,
  ScanLimits,
  ScanProfile,
  ScanRecord,
  ScanResultPayload,
  SettingsPatch,
  SettingsView,
  SignatureInventory,
  SignatureUpdateResult,
  UpdateLogs,
} from "../types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),

  engineStatus: () => invoke<EngineStatus>("engine_status"),
  updateSignatures: (confirm: boolean) =>
    invoke<SignatureUpdateResult>("update_signatures", { confirm }),
  installClamav: (confirm: boolean) =>
    invoke<ClamavInstallResult>("install_clamav", { confirm }),

  startScan: (input: {
    paths: string[];
    recursive: boolean;
    includePua: boolean;
    profile: ScanProfile;
    limits: ScanLimits;
    followSymlinks?: boolean;
  }) => invoke<ScanResultPayload>("start_scan", input),
  cancelScan: () => invoke<boolean>("cancel_scan"),
  resolveScanTargets: (profile: ScanProfile) =>
    invoke<ResolvedTargets>("resolve_scan_targets", { profile }),
  exportScanReport: (scanId: number, format: string, path: string) =>
    invoke<ExportResult>("export_scan_report", { scanId, format, path }),

  signatureInventory: () => invoke<SignatureInventory>("signature_inventory"),
  updateLogs: () => invoke<UpdateLogs>("update_logs"),
  provisioningStatus: () => invoke<ProvisioningStatus>("provisioning_status"),
  openDocumentation: (url: string) => invoke<void>("open_documentation", { url }),

  listScans: (limit = 20) => invoke<ScanRecord[]>("list_scans", { limit }),
  getScanDetails: (scanId: number) =>
    invoke<ScanDetails | null>("get_scan_details", { scanId }),
  dashboardStats: () => invoke<DashboardStats>("dashboard_stats"),

  quarantineFile: (
    path: string,
    threatName: string,
    sha256: string | null,
    confirm: boolean,
  ) =>
    invoke<QuarantineRecord>("quarantine_file", {
      path,
      threatName,
      sha256,
      confirm,
    }),
  listQuarantine: () => invoke<QuarantineRecord[]>("list_quarantine"),
  restoreQuarantine: (id: number, confirm: boolean) =>
    invoke<string>("restore_quarantine", { id, confirm }),
  deleteQuarantine: (id: number, confirm: boolean, phrase: string) =>
    invoke<void>("delete_quarantine", { id, confirm, phrase }),

  getSettings: () => invoke<SettingsView>("get_settings"),
  updateSettings: (patch: SettingsPatch) =>
    invoke<SettingsView>("update_settings", { patch }),
  openDataDir: () => invoke<void>("open_data_dir"),
  setTrayLanguage: (language: string) =>
    invoke<boolean>("set_tray_language", { language }),

  netmonSnapshot: () => invoke<NetmonSnapshotPayload>("netmon_snapshot"),
  netmonHistory: (limit = 40) => invoke<NetmonSnapshotRecord[]>("netmon_history", { limit }),
  firewallStatus: () => invoke<FirewallObservation>("firewall_status"),
  firewallAcknowledgeBaseline: () =>
    invoke<FirewallObservation>("firewall_acknowledge_baseline"),
  firewallConnections: () => invoke<FirewallConnections>("firewall_connections"),
  firewallExportSnapshot: () =>
    invoke<FirewallSnapshotExport>("firewall_export_snapshot"),
  firewallSnapshotHistory: () =>
    invoke<FirewallSnapshotInfo[]>("firewall_snapshot_history"),
  firewallVerifySnapshot: (path: string) =>
    invoke<FirewallSnapshotVerification>("firewall_verify_snapshot", { path }),
  firewallManagementStatus: () =>
    invoke<RuleManagementStatus>("firewall_management_status"),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; code?: unknown };
    if (typeof maybe.message === "string" && maybe.message.trim()) {
      return maybe.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Une erreur inattendue est survenue.";
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}
