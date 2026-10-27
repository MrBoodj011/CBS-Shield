import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../lib/i18n";
import type { DashboardStats, EngineStatus, QuarantineRecord } from "../types";
import { Dashboard } from "./Dashboard";

const installedEngine: EngineStatus = {
  installed: true,
  clamscanPath: "C:\\Program Files\\ClamAV\\clamscan.exe",
  freshclamPath: "C:\\Program Files\\ClamAV\\freshclam.exe",
  sigtoolPath: "C:\\Program Files\\ClamAV\\sigtool.exe",
  engineVersion: "1.4.3",
  signatureVersion: "27000",
  signatureDate: "2026-10-25",
  signatureAgeDays: 1,
  signatureState: "upToDate",
  databasePath: "C:\\Program Files\\ClamAV\\database",
  databaseFileCount: 3,
  checkedAt: "2026-10-26T09:00:00Z",
  message: "Signatures à jour.",
};

const stats: DashboardStats = {
  totalScans: 12,
  totalDetections: 2,
  totalFilesScanned: 42_000,
  activeQuarantine: 1,
  restoredQuarantine: 0,
  lastScan: {
    id: 12,
    uuid: "scan-12",
    startedAt: "2026-10-26T08:00:00Z",
    finishedAt: "2026-10-26T08:04:00Z",
    durationMs: 240_000,
    targets: ["C:\\Users\\adjar\\Documents"],
    filesScanned: 4200,
    infectedFiles: 0,
    errorCount: 0,
    outcome: "clean",
    cancelled: false,
    engineVersion: "1.4.3",
    signatureVersion: "27000",
    fatalError: null,
  },
};

const quarantine: QuarantineRecord[] = [
  {
    id: 1,
    itemId: "8c8d0b0e-0000-0000-0000-000000000000",
    fileName: "eicar.com",
    originalPath: "C:\\Users\\adjar\\Downloads\\eicar.com",
    storedPath: "C:\\Users\\adjar\\AppData\\Roaming\\cbs-shield\\quarantine\\item.bin",
    sha256: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    sizeBytes: 68,
    threatName: "Eicar-Test-Signature",
    status: "active",
    createdAt: "2026-10-21T10:03:00Z",
    restoredAt: null,
    sourceScanId: 2,
  },
];

vi.mock("../lib/api", () => ({
  api: {
    firewallStatus: vi.fn(async () => ({
      status: {
        checkedAt: "2026-10-26T09:00:00Z",
        profiles: [
          { profile: "domain", enabled: true, inboundDefault: "block", outboundDefault: "allow" },
          { profile: "private", enabled: true, inboundDefault: "block", outboundDefault: "allow" },
          { profile: "public", enabled: false, inboundDefault: "block", outboundDefault: "allow" },
        ],
        activeProfiles: ["domain", "private"],
        rules: [],
        rulesTotalCount: 0,
        rulesHash: "hash",
        profilesHash: "profiles-hash",
        configurationHash: "configuration-hash",
      },
      previousCheckedAt: null,
      changedSinceLast: false,
      changes: [],
      alerts: [
        { code: "profile_disabled", severity: "warning", profile: "public" },
        { code: "inbound_default_allow", severity: "warning", profile: "private" },
      ],
      listedTruncated: false,
    })),
    netmonHistory: vi.fn(async () => [
      {
        id: 7,
        capturedAt: "2026-10-26T08:59:00Z",
        tcpTotal: 42,
        tcpEstablished: 11,
        udpTotal: 18,
        rxBytesDelta: 2_500_000,
        txBytesDelta: 300_000,
        topProcesses: [],
      },
    ]),
  },
  errorMessage: (error: unknown) => String(error),
}));

function renderDashboard(engine: EngineStatus | null) {
  return render(
    <I18nProvider language="fr">
      <Dashboard
        engine={engine}
        stats={stats}
        scans={stats.lastScan ? [stats.lastScan] : []}
        quarantine={quarantine}
        info={{
          product: "CBS Shield",
          version: "0.7.0-dev",
          vendor: "Cybrense",
          phase: "Phase 3",
          disclaimer: "Protection manuelle expérimentale.",
          dataDir: "C:\\Users\\adjar\\AppData\\Roaming\\cbs-shield",
        }}
        onNavigate={() => undefined}
      />
    </I18nProvider>,
  );
}

describe("Dashboard", () => {
  it("never claims full protection when ClamAV is missing", async () => {
    renderDashboard(null);

    expect(await screen.findByText("Analyse manuelle indisponible")).toBeInTheDocument();
    expect(screen.getAllByText("Temps réel inactif").length).toBeGreaterThan(0);
    expect(screen.queryByText(/entièrement protégé/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fully protected/i)).not.toBeInTheDocument();
    // The firewall status comes from the real observation payload (2/3 enabled).
    await waitFor(() => {
      expect(screen.getByText("2 profil(s) actif(s)")).toBeInTheDocument();
    });
  });

  it("renders the real engine, signature, quarantine and traffic values", async () => {
    renderDashboard(installedEngine);

    expect(await screen.findByText("Analyse manuelle prête")).toBeInTheDocument();
    expect(screen.getByText("1.4.3")).toBeInTheDocument();
    expect(screen.getByText("27000")).toBeInTheDocument();
    // Quarantine count is derived from the real active records.
    expect(screen.getByText("1 élément(s)")).toBeInTheDocument();
    // Network figures are the last persisted capture, not an estimate.
    await waitFor(() => {
      expect(screen.getByText(/2,38 Mo reçus/)).toBeInTheDocument();
    });
    // Detections are surfaced as a real event.
    expect(screen.getByText("Fichier isolé en quarantaine")).toBeInTheDocument();
  });
});
