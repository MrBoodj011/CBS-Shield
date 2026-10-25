export type SignatureState = "missing" | "outdated" | "upToDate" | "unknown";

export interface EngineStatus {
  installed: boolean;
  clamscanPath: string | null;
  freshclamPath: string | null;
  engineVersion: string | null;
  signatureVersion: string | null;
  signatureDate: string | null;
  signatureAgeDays: number | null;
  signatureState: SignatureState;
  databasePath: string | null;
  databaseFileCount: number;
  checkedAt: string;
  message: string;
}

export type ScanOutcome =
  | "clean"
  | "detected"
  | "cancelled"
  | "completedWithErrors"
  | "failed";

export interface Detection {
  filePath: string;
  threatName: string;
  fileSizeBytes: number | null;
  sha256: string | null;
}

export interface ScanErrorRecord {
  path: string;
  message: string;
}

export interface ScanSummary {
  scannedFiles: number | null;
  infectedFiles: number | null;
  scannedDirectories: number | null;
  knownViruses: number | null;
  dataScanned: string | null;
  elapsedSeconds: number | null;
}

export interface ScanReport {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targets: string[];
  filesScanned: number;
  infectedFiles: number;
  errorCount: number;
  detections: Detection[];
  errors: ScanErrorRecord[];
  outcome: ScanOutcome;
  cancelled: boolean;
  engineVersion: string | null;
  signatureVersion: string | null;
  summary: ScanSummary | null;
  fatalError: string | null;
}

export interface ScanResultPayload {
  report: ScanReport;
  recordId: number | null;
  persistenceError: string | null;
}

export type ScanEvent =
  | {
      kind: "started";
      scanId: string;
      targetCount: number;
      engineVersion: string | null;
      signatureVersion: string | null;
    }
  | {
      kind: "progress";
      scanId: string;
      filesScanned: number;
      threatsFound: number;
      currentFile: string | null;
    }
  | {
      kind: "detection";
      scanId: string;
      filePath: string;
      threatName: string;
    }
  | {
      kind: "scanError";
      scanId: string;
      path: string;
      message: string;
    }
  | {
      kind: "finished";
      scanId: string;
      report: ScanReport;
    };

export interface ScanRecord {
  id: number;
  uuid: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targets: string[];
  filesScanned: number;
  infectedFiles: number;
  errorCount: number;
  outcome: string;
  cancelled: boolean;
  engineVersion: string | null;
  signatureVersion: string | null;
  fatalError: string | null;
}

export interface StoredDetection {
  id: number;
  scanId: number;
  filePath: string;
  threatName: string;
  fileSizeBytes: number | null;
  sha256: string | null;
}

export interface ScanDetails {
  scan: ScanRecord;
  detections: StoredDetection[];
}

export interface DashboardStats {
  totalScans: number;
  totalDetections: number;
  totalFilesScanned: number;
  activeQuarantine: number;
  restoredQuarantine: number;
  lastScan: ScanRecord | null;
}

export type QuarantineStatus = "active" | "restored" | "deleted";

export interface QuarantineRecord {
  id: number;
  itemId: string;
  fileName: string;
  originalPath: string;
  storedPath: string;
  sha256: string;
  sizeBytes: number;
  threatName: string;
  status: QuarantineStatus;
  createdAt: string;
  restoredAt: string | null;
  sourceScanId: number | null;
}

export interface SettingsView {
  theme: "dark" | "light" | "system" | string;
  recursive: boolean;
  includePua: boolean;
  clamscanPath: string | null;
  databasePath: string | null;
  signatureMaxAgeDays: number;
  dataDir: string;
  historyPath: string;
  quarantinePath: string;
  signatureDbPath: string;
  freshclamConfPath: string;
  appVersion: string;
}

export interface SettingsPatch {
  theme?: string;
  recursive?: boolean;
  includePua?: boolean;
  clamscanPath?: string;
  databasePath?: string;
  signatureMaxAgeDays?: number;
}

export interface AppInfo {
  product: string;
  version: string;
  vendor: string;
  phase: string;
  disclaimer: string;
  dataDir: string;
}

export interface SignatureUpdateEvent {
  line: string;
  stream: string;
}

export interface SignatureUpdateResult {
  success: boolean;
  exitCode: number | null;
  message: string;
  log: string[];
  engine: EngineStatus;
}

export interface CommandError {
  code: string;
  message: string;
}

export type SectionId =
  | "dashboard"
  | "antivirus"
  | "firewall"
  | "network"
  | "quarantine"
  | "settings";
