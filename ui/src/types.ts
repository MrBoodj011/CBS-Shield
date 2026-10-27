export type SignatureState = "missing" | "outdated" | "upToDate" | "unknown";

export interface EngineStatus {
  installed: boolean;
  clamscanPath: string | null;
  freshclamPath: string | null;
  sigtoolPath: string | null;
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

export type ScanProfile = "quick" | "full" | "custom";

export interface ScanLimits {
  maxFileSizeMb: number;
  maxScanSizeMb: number;
  maxFiles: number;
  maxRecursion: number;
  maxDurationMinutes: number;
  scanArchives: boolean;
  lowPriority: boolean;
}

export interface ResolvedTargets {
  profile: ScanProfile;
  targets: string[];
  excluded: string[];
}

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
  profile: string;
  excluded: string[];
  indexedFiles: number | null;
  indexTruncated: boolean;
  limits: ScanLimits;
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
      kind: "preparing";
      scanId: string;
      profile: string;
      targetCount: number;
    }
  | {
      kind: "started";
      scanId: string;
      targetCount: number;
      engineVersion: string | null;
      signatureVersion: string | null;
      profile: string;
      totalFiles: number | null;
      indexTruncated: boolean;
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
  language: "fr" | "en" | string;
  recursive: boolean;
  includePua: boolean;
  clamscanPath: string | null;
  databasePath: string | null;
  signatureMaxAgeDays: number;
  autoUpdate: boolean;
  autoUpdateHours: number;
  onboardingCompleted: boolean;
  dataDir: string;
  historyPath: string;
  quarantinePath: string;
  signatureDbPath: string;
  freshclamConfPath: string;
  appVersion: string;
}

export interface SettingsPatch {
  theme?: string;
  language?: string;
  recursive?: boolean;
  includePua?: boolean;
  clamscanPath?: string;
  databasePath?: string;
  signatureMaxAgeDays?: number;
  autoUpdate?: boolean;
  autoUpdateHours?: number;
  onboardingCompleted?: boolean;
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
  inventory: SignatureInventory;
  offline: boolean;
  databaseVerified: boolean;
  staleTempRemoved: number;
  automatic: boolean;
}

export interface SignatureComponent {
  file: string;
  version: string | null;
  signatures: number | null;
  buildTime: string | null;
  verified: boolean;
  md5: string | null;
}

export interface CustomSignatureFile {
  file: string;
  signatures: number;
}

export interface SignatureInventory {
  databaseDir: string | null;
  sigtoolAvailable: boolean;
  officialComponents: SignatureComponent[];
  officialSignatures: number;
  customSignatureFiles: CustomSignatureFile[];
  customSignatures: number;
  checkedAt: string;
  notes: string[];
}

export interface UpdateLogs {
  appLogPath: string;
  freshclamLogPath: string;
  appLines: string[];
  freshclamLines: string[];
}

export interface ProvisioningStatus {
  wingetAvailable: boolean;
  wingetVersion: string | null;
  clamavInstalled: boolean;
  clamscanPath: string | null;
  databasePath: string | null;
  installCommand: string;
  probeCommand: string;
  docsUrl: string;
  licenseNote: string;
  checkedAt: string;
}

export interface ClamavInstallResult {
  attempted: boolean;
  success: boolean;
  exitCode: number | null;
  installed: boolean;
  message: string;
  engine: EngineStatus;
}

export interface ExportResult {
  path: string;
  format: string;
  bytes: number;
}

export interface CommandError {
  code: string;
  message: string;
}

export type SectionId =
  | "dashboard"
  | "antivirus"
  | "history"
  | "quarantine"
  | "network"
  | "firewall"
  | "settings"
  | "updates"
  | "about";

// ---------------------------------------------------------------------------
// Network Monitor (Sprint 2 — read-only observation)
// ---------------------------------------------------------------------------

export type NetmonTransport = "tcp" | "udp";

export interface NetmonConnection {
  transport: NetmonTransport;
  localIp: string;
  localPort: number;
  remoteIp: string | null;
  remotePort: number | null;
  /** TCP state (e.g. "ESTABLISHED"); null for UDP bindings. */
  state: string | null;
  pid: number;
  /** Best-effort process name; null when the process is not identifiable. */
  processName: string | null;
  /** Full image path when Windows allows the read-only query. */
  processPath: string | null;
}

export interface NetmonInterfaceTraffic {
  alias: string;
  interfaceType: string;
  /** Cumulative counters at capture time (NDIS InOctets/OutOctets). */
  rxBytes: number;
  txBytes: number;
}

export interface NetmonSnapshot {
  capturedAt: string;
  tcpConnections: NetmonConnection[];
  /** UDP has no connections: rows are local bindings. */
  udpBindings: NetmonConnection[];
  interfaces: NetmonInterfaceTraffic[];
}

export interface NetmonProcessCount {
  name: string;
  connections: number;
}

export interface NetmonSnapshotPayload {
  snapshot: NetmonSnapshot;
  tcpTotal: number;
  tcpEstablished: number;
  udpTotal: number;
  /** Measured byte delta between this capture and the previous one (0 on the
   * very first capture of the session — no interval exists yet). */
  rxBytesDelta: number;
  txBytesDelta: number;
  topProcesses: NetmonProcessCount[];
  historyRows: number;
  persistenceError: string | null;
}

export interface NetmonSnapshotRecord {
  id: number;
  capturedAt: string;
  tcpTotal: number;
  tcpEstablished: number;
  udpTotal: number;
  rxBytesDelta: number;
  txBytesDelta: number;
  topProcesses: NetmonProcessCount[];
}

// ---------------------------------------------------------------------------
// Firewall foundation (Sprint 2 — strictly read-only inspection)
// ---------------------------------------------------------------------------

export interface FirewallProfileStatus {
  profile: string;
  enabled: boolean;
  inboundDefault: string;
  outboundDefault: string;
}

export interface FirewallRuleSummary {
  name: string;
  grouping: string;
  description: string;
  applicationName: string;
  serviceName: string;
  direction: string;
  action: string;
  enabled: boolean;
  protocol: string;
  localPorts: string;
  remotePorts: string;
  profiles: string;
}

export interface FirewallStatus {
  checkedAt: string;
  profiles: FirewallProfileStatus[];
  /** Bitmask of profiles Windows currently applies, as display labels. */
  activeProfiles: string[];
  /** Rules listed for display (bounded extract when `rulesTotalCount` is larger). */
  rules: FirewallRuleSummary[];
  rulesTotalCount: number;
  rulesHash: string;
  profilesHash: string;
  configurationHash: string;
}

export type FirewallSeverity = "danger" | "warning" | "info";

export interface FirewallAlert {
  code: string;
  severity: FirewallSeverity;
  profile: string | null;
}

export interface FirewallChange {
  code: string;
  profile: string | null;
}

export interface FirewallObservation {
  status: FirewallStatus;
  previousCheckedAt: string | null;
  changedSinceLast: boolean;
  changes: FirewallChange[];
  alerts: FirewallAlert[];
  listedTruncated: boolean;
}

export interface FirewallConnectionRow {
  transport: string;
  localEndpoint: string;
  remoteEndpoint: string | null;
  state: string | null;
  pid: number;
  processName: string | null;
  processPath: string | null;
  matchingRules: string[];
  matchingRuleCount: number;
}

export interface FirewallConnections {
  capturedAt: string;
  firewallCheckedAt: string | null;
  mappingAvailable: boolean;
  mappingLimited: boolean;
  rulesListed: number;
  rulesTotalCount: number;
  tcpTotal: number;
  udpTotal: number;
  rows: FirewallConnectionRow[];
  rowsTruncated: boolean;
  mappedRows: number;
  unmappedRows: number;
}

export interface FirewallSnapshotExport {
  path: string;
  rulesSaved: number;
  rulesTotalCount: number;
  truncated: boolean;
  checkedAt: string;
}

export interface RuleManagementGate {
  code: string;
  satisfied: boolean;
}

export interface RuleManagementStatus {
  enabled: boolean;
  mutationApiExposed: boolean;
  backupDirectory: string;
  snapshotCount: number;
  lastSnapshotAt: string | null;
  gates: RuleManagementGate[];
  rollbackDesignVersion: string;
}
