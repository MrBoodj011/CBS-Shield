/**
 * Dev-only fake backend so the interface can be previewed in a plain browser
 * (`npm run dev` without Tauri). It is imported dynamically from main.tsx only
 * when `import.meta.env.DEV` is true and no Tauri runtime is present, so it is
 * never part of a production bundle.
 */
import { mockIPC } from "@tauri-apps/api/mocks";

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const engine = {
  installed: true,
  clamscanPath: "C:\\Program Files\\ClamAV\\clamscan.exe",
  freshclamPath: "C:\\Program Files\\ClamAV\\freshclam.exe",
  sigtoolPath: "C:\\Program Files\\ClamAV\\sigtool.exe",
  engineVersion: "1.4.2",
  signatureVersion: "27463",
  signatureDate: ago(60 * 9),
  signatureAgeDays: 0,
  signatureState: "upToDate",
  databasePath: "C:\\ProgramData\\CBS Shield\\clamav\\db",
  databaseFileCount: 3,
  checkedAt: now(),
  message: "ClamAV détecté",
};

let settings = {
  theme: "dark",
  language: "fr",
  recursive: true,
  includePua: false,
  clamscanPath: null,
  databasePath: null,
  signatureMaxAgeDays: 7,
  autoUpdate: true,
  autoUpdateHours: 6,
  onboardingCompleted: true,
  dataDir: "C:\\Users\\demo\\AppData\\Roaming\\CBS Shield",
  historyPath: "C:\\Users\\demo\\AppData\\Roaming\\CBS Shield\\history.db",
  quarantinePath: "C:\\Users\\demo\\AppData\\Roaming\\CBS Shield\\quarantine",
  signatureDbPath: "C:\\ProgramData\\CBS Shield\\clamav\\db",
  freshclamConfPath: "C:\\ProgramData\\CBS Shield\\clamav\\freshclam.conf",
  appVersion: "0.9.0-dev",
};

const scans = [
  {
    id: 42, uuid: "a1", startedAt: ago(95), finishedAt: ago(92), durationMs: 184_000,
    targets: ["C:\\Users\\demo\\Downloads", "C:\\Users\\demo\\Desktop"],
    filesScanned: 4821, infectedFiles: 0, errorCount: 0, outcome: "clean", cancelled: false,
    engineVersion: "1.4.2", signatureVersion: "27463", fatalError: null,
  },
  {
    id: 41, uuid: "a2", startedAt: ago(60 * 26), finishedAt: ago(60 * 26 - 4), durationMs: 241_000,
    targets: ["C:\\Users\\demo\\Downloads"],
    filesScanned: 3120, infectedFiles: 1, errorCount: 0, outcome: "detected", cancelled: false,
    engineVersion: "1.4.2", signatureVersion: "27462", fatalError: null,
  },
  {
    id: 40, uuid: "a3", startedAt: ago(60 * 50), finishedAt: ago(60 * 50 - 1), durationMs: 61_000,
    targets: ["D:\\Projets"],
    filesScanned: 912, infectedFiles: 0, errorCount: 3, outcome: "completedWithErrors", cancelled: false,
    engineVersion: "1.4.2", signatureVersion: "27461", fatalError: null,
  },
];

const quarantine = [
  {
    id: 7, itemId: "q7", fileName: "invoice_2026.pdf.exe",
    originalPath: "C:\\Users\\demo\\Downloads\\invoice_2026.pdf.exe",
    storedPath: "C:\\Users\\demo\\AppData\\Roaming\\CBS Shield\\quarantine\\q7.bin",
    sha256: "9f2c4b1e7a0d3c5e8b6a2f1d4c7e9b0a3d5f8c1e2b4a6d8f0c3e5b7a9d1f2c4e",
    sizeBytes: 184_320, threatName: "Win.Trojan.Agent-1234", status: "active",
    createdAt: ago(60 * 26), restoredAt: null, sourceScanId: 41,
  },
];

const profiles = [
  { profile: "Domain", enabled: true, inboundDefault: "Block", outboundDefault: "Allow" },
  { profile: "Private", enabled: true, inboundDefault: "Block", outboundDefault: "Allow" },
  { profile: "Public", enabled: true, inboundDefault: "Block", outboundDefault: "Allow" },
];

const rules = Array.from({ length: 12 }, (_, i) => ({
  name: ["Core Networking - DNS (UDP-Out)", "Microsoft Edge (mDNS-In)", "Steam", "Remote Assistance (TCP-In)", "File and Printer Sharing (Echo Request - ICMPv4-In)", "Windows Media Player Network Sharing", "Spotify Music", "Cast to Device streaming server (HTTP-Streaming-In)", "Delivery Optimization (TCP-In)", "mDNS (UDP-In)", "Microsoft Teams", "Wi-Fi Direct Network Discovery (In)"][i],
  grouping: i % 3 === 0 ? "Core Networking" : "",
  description: "Règle observée en lecture seule.",
  applicationName: i % 2 ? "C:\\Program Files\\App\\app.exe" : "",
  serviceName: "",
  direction: i % 2 ? "In" : "Out",
  action: i % 4 === 3 ? "Block" : "Allow",
  enabled: i % 5 !== 4,
  protocol: i % 2 ? "TCP" : "UDP",
  localPorts: i % 2 ? "443" : "Any",
  remotePorts: "Any",
  profiles: "Private, Public",
}));

const firewallStatus = {
  checkedAt: now(),
  profiles,
  activeProfiles: ["Private"],
  rules,
  rulesTotalCount: 412,
  rulesHash: "4b1e7a0d3c5e8b6a",
  profilesHash: "2f1d4c7e9b0a3d5f",
  configurationHash: "8c1e2b4a6d8f0c3e",
};

const connRows = Array.from({ length: 10 }, (_, i) => ({
  transport: i % 3 === 0 ? "udp" : "tcp",
  localEndpoint: `192.168.1.24:${50100 + i}`,
  remoteEndpoint: i % 3 === 0 ? null : `${[142, 20, 104, 151][i % 4]}.${i * 7}.${i * 3}.${10 + i}:443`,
  state: i % 3 === 0 ? null : "ESTABLISHED",
  pid: 4000 + i * 37,
  processName: ["chrome.exe", "Teams.exe", "svchost.exe", "Spotify.exe", "OneDrive.exe"][i % 5],
  processPath: null,
  matchingRules: i % 2 ? ["Microsoft Teams"] : [],
  matchingRuleCount: i % 2,
}));

const netConns = (n: number, transport: "tcp" | "udp") =>
  Array.from({ length: n }, (_, i) => ({
    transport,
    localIp: "192.168.1.24",
    localPort: 50000 + i,
    remoteIp: transport === "tcp" ? `142.250.${i}.${20 + i}` : null,
    remotePort: transport === "tcp" ? 443 : null,
    state: transport === "tcp" ? (i % 4 ? "ESTABLISHED" : "LISTEN") : null,
    pid: 3000 + i * 11,
    processName: ["chrome.exe", "Teams.exe", "svchost.exe", "Spotify.exe", "OneDrive.exe", null][i % 6],
    processPath: null,
  }));

const netmonPayload = () => ({
  snapshot: {
    capturedAt: now(),
    tcpConnections: netConns(14, "tcp"),
    udpBindings: netConns(6, "udp"),
    interfaces: [
      { alias: "Wi-Fi", interfaceType: "wireless", rxBytes: 9_812_331_002, txBytes: 1_203_998_112 },
      { alias: "Ethernet", interfaceType: "ethernet", rxBytes: 0, txBytes: 0 },
    ],
  },
  tcpTotal: 14, tcpEstablished: 10, udpTotal: 6,
  rxBytesDelta: 2_481_220, txBytesDelta: 312_884,
  topProcesses: [
    { name: "chrome.exe", connections: 7 },
    { name: "Teams.exe", connections: 4 },
    { name: "svchost.exe", connections: 3 },
  ],
  historyRows: 18,
  persistenceError: null,
});

const netmonHistory = Array.from({ length: 12 }, (_, i) => ({
  id: 100 - i, capturedAt: ago(i * 5),
  tcpTotal: 12 + (i % 4), tcpEstablished: 9 + (i % 3), udpTotal: 6,
  rxBytesDelta: 1_200_000 + i * 90_000, txBytesDelta: 200_000 + i * 12_000,
  topProcesses: [{ name: "chrome.exe", connections: 6 }],
}));

let webguard = {
  checkedAt: now(),
  health: {
    checkedAt: now(), service: "running", serviceObservable: true,
    adapters: [
      { name: "Wi-Fi", description: "Intel(R) Wi-Fi 6E AX211", interfaceKind: "wireless", up: true, dnsServers: ["192.168.1.1"], dnsSuffix: "home", probableVpn: false },
    ],
    resolvers: ["192.168.1.1"], probableVpn: false, encryptedDnsEvidence: false,
    proxyConfigured: null, healthy: true, readOnly: true,
  },
  proxy: { running: false, endpoint: "127.0.0.1:5353", mode: "local", startedAt: null as string | null, lastError: null, systemDnsModified: false, activeEnforcement: false },
  counts: { blocklist: 18_422, allowlist: 2, filters: 2, malware: 12_031, phishing: 6_391, events: 4, blockedEvents: 2, allowedEvents: 2, errorEvents: 0 },
  filters: [
    { id: "f1", name: "URLhaus", category: "malware", importedAt: ago(600), entryCount: 12_031, sha256: "aa11bb22cc33dd44" },
    { id: "f2", name: "OpenPhish", category: "phishing", importedAt: ago(620), entryCount: 6_391, sha256: "ee55ff66aa77bb88" },
  ],
  events: [
    { id: "e1", occurredAt: ago(12), domain: "malware-test.example", action: "blocked", category: "malware", matchedRule: "malware-test.example", source: "URLhaus", upstream: null, latencyMs: 1, detail: "" },
    { id: "e2", occurredAt: ago(14), domain: "github.com", action: "allowed", category: null, matchedRule: null, source: "", upstream: "192.168.1.1", latencyMs: 18, detail: "" },
  ],
  allowlist: [{ domain: "intranet.local", note: "Réseau interne", addedAt: ago(9000) }],
  blocklist: [{ domain: "malware-test.example", category: "malware", source: "URLhaus", importedAt: ago(600) }],
  blocklistTotal: 18_422, blocklistTruncated: true, stateError: null,
  systemDnsModified: false, restorationRequired: false, activeEnforcement: false,
  limitationCodes: ["no_system_dns", "no_doh_coverage"],
};

let proactive = {
  running: false, paused: false, autoWatch: false,
  config: { cycleSeconds: 30, maxFilesPerCycle: 50, maxFileSizeMb: 64, maxDepth: 4 },
  directories: ["C:\\Users\\demo\\Downloads"],
  trackedFiles: 214, queueCount: 0,
  events: [
    { id: "p1", occurredAt: ago(3), kind: "created", path: "C:\\Users\\demo\\Downloads\\setup.msi", detail: "" },
    { id: "p2", occurredAt: ago(8), kind: "modified", path: "C:\\Users\\demo\\Downloads\\notes.txt", detail: "" },
  ],
  lastCycleAt: ago(1), lastError: null, activeEnforcement: false, notRealTime: true,
};

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  app_info: () => ({ product: "CBS Shield", version: "0.9.0-dev", vendor: "Cybrense", phase: "beta", disclaimer: "", dataDir: settings.dataDir }),
  engine_status: () => ({ ...engine, checkedAt: now() }),
  get_settings: () => settings,
  update_settings: (args) => {
    settings = { ...settings, ...(args.patch as object) };
    return settings;
  },
  set_tray_language: () => true,
  dashboard_stats: () => ({ totalScans: 42, totalDetections: 3, totalFilesScanned: 128_440, activeQuarantine: 1, restoredQuarantine: 1, lastScan: scans[0] }),
  list_quarantine: () => quarantine,
  signature_inventory: () => ({
    databaseDir: engine.databasePath, sigtoolAvailable: true,
    officialComponents: [
      { file: "main.cvd", version: "62", signatures: 6_647_427, buildTime: ago(60 * 24 * 400) },
      { file: "daily.cld", version: "27463", signatures: 2_068_119, buildTime: ago(60 * 9) },
      { file: "bytecode.cvd", version: "335", signatures: 86, buildTime: ago(60 * 24 * 90) },
    ],
    officialSignatures: 8_715_632, customSignatureFiles: [], customSignatures: 0,
    checkedAt: now(), notes: [],
  }),
  update_logs: () => ({ appLogPath: "app.log", freshclamLogPath: "freshclam.log", appLines: ["[info] Signatures à jour"], freshclamLines: ["daily.cld database is up-to-date (version: 27463)"] }),
  provisioning_status: () => ({
    wingetAvailable: true, wingetVersion: "1.9", clamavInstalled: true, clamscanPath: engine.clamscanPath,
    databasePath: engine.databasePath, installCommand: "winget install ClamAV", probeCommand: "clamscan --version",
    docsUrl: "https://docs.clamav.net", licenseNote: "GPL-2.0", checkedAt: now(),
    portableAvailable: true, portableVersion: "1.4.2", portableUrl: "https://www.clamav.net",
    portableSha256: "abc", portableSize: 42_000_000, portableInstallDir: "C:\\ProgramData\\CBS Shield\\clamav",
    preferredMethod: "portable",
  }),
  list_scans: () => scans,
  get_scan_details: (args) => {
    const scan = scans.find((s) => s.id === args.scanId) ?? scans[0];
    return {
      scan,
      detections: scan.infectedFiles
        ? [{ id: 1, scanId: scan.id, filePath: quarantine[0].originalPath, threatName: quarantine[0].threatName, fileSizeBytes: 184_320, sha256: quarantine[0].sha256 }]
        : [],
    };
  },
  resolve_scan_targets: () => ({ profile: "quick", targets: ["C:\\Users\\demo\\Downloads", "C:\\Users\\demo\\Desktop", "C:\\Users\\demo\\Documents"], skipped: [] }),
  netmon_snapshot: netmonPayload,
  netmon_history: (args) => netmonHistory.slice(0, (args.limit as number) ?? 40),
  firewall_status: () => ({ status: firewallStatus, previousCheckedAt: ago(30), changedSinceLast: false, changes: [], alerts: [], service: { mpsSvc: "running", bfe: "running", observed: true, checkedAt: now() }, listedTruncated: true }),
  firewall_connections: () => ({ capturedAt: now(), firewallCheckedAt: now(), mappingAvailable: true, mappingLimited: false, rulesListed: 12, rulesTotalCount: 412, tcpTotal: 7, udpTotal: 3, rows: connRows, rowsTruncated: false, mappedRows: 5, unmappedRows: 5 }),
  firewall_snapshot_history: () => [
    { path: "C:\\snap\\fw-1.json", fileName: "fw-2026-11-24.json", bytes: 88_120, modifiedAt: ago(1440), checkedAt: ago(1440), rulesSaved: 412, rulesTotalCount: 412, truncated: false, sha256: "4b1e7a0d3c5e8b6a2f1d4c7e9b0a3d5f", integrity: "matched", sidecarPresent: true },
  ],
  firewall_management_status: () => ({
    enabled: false, mutationApiExposed: false, backupDirectory: "C:\\snap", snapshotCount: 1, verifiedSnapshotCount: 1,
    lastSnapshotAt: ago(1440), rollbackDesignVersion: "1",
    gates: [{ code: "snapshot_verified", satisfied: true }, { code: "rollback_rehearsed", satisfied: false }, { code: "isolation_test", satisfied: false }],
  }),
  webguard_snapshot: () => webguard,
  webguard_start_monitor: () => {
    webguard = { ...webguard, proxy: { ...webguard.proxy, running: true, startedAt: now() } };
    return webguard;
  },
  webguard_stop_monitor: () => {
    webguard = { ...webguard, proxy: { ...webguard.proxy, running: false, startedAt: null } };
    return webguard;
  },
  proactive_snapshot: () => proactive,
  proactive_scan_status: () => ({ enabled: false, running: false, cancelRequested: false, busyFiles: null, lastError: null, lastBatch: null }),
  proactive_start: () => (proactive = { ...proactive, running: true }),
  proactive_stop: () => (proactive = { ...proactive, running: false, paused: false }),
  proactive_pause: () => (proactive = { ...proactive, paused: true }),
  proactive_resume: () => (proactive = { ...proactive, paused: false }),
  proactive_drain: () => [],
};

export function installMockBackend(): void {
  mockIPC(
    async (cmd, args) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const handler = handlers[cmd];
      if (!handler) {
        throw { code: "dev_mock", message: `Commande non simulée en mode navigateur : ${cmd}` };
      }
      return handler((args ?? {}) as Record<string, unknown>);
    },
    { shouldMockEvents: true },
  );
  // eslint-disable-next-line no-console
  console.info("[CBS Shield] Backend simulé (aperçu navigateur).");
}
