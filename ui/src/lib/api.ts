import { invoke } from "@tauri-apps/api/core";

import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  FirewallObservation,
  NetmonSnapshotPayload,
  NetmonSnapshotRecord,
  QuarantineRecord,
  ScanDetails,
  ScanRecord,
  ScanResultPayload,
  SettingsPatch,
  SettingsView,
  SignatureUpdateResult,
} from "../types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),

  engineStatus: () => invoke<EngineStatus>("engine_status"),
  updateSignatures: (confirm: boolean) =>
    invoke<SignatureUpdateResult>("update_signatures", { confirm }),

  startScan: (paths: string[], recursive: boolean, includePua: boolean) =>
    invoke<ScanResultPayload>("start_scan", { paths, recursive, includePua }),
  cancelScan: () => invoke<boolean>("cancel_scan"),

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
