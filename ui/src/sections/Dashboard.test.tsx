import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../lib/i18n";
import type { EngineStatus } from "../types";
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
        onNavigate={() => undefined}
      />
    </I18nProvider>,
  );
}

describe("Dashboard", () => {
  it("never claims full protection when ClamAV is missing", async () => {
    renderDashboard({
      ...installedEngine,
      installed: false,
      engineVersion: null,
      signatureVersion: null,
      signatureState: "missing",
    });

    expect(await screen.findByText("Antivirus")).toBeInTheDocument();
    expect(screen.getAllByText("Moteur absent").length).toBeGreaterThan(0);
    expect(screen.queryByText(/entièrement protégé/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fully protected/i)).not.toBeInTheDocument();
  });

  it("shows a neutral checking state while the engine status loads", async () => {
    renderDashboard(null);

    expect(await screen.findByText("Antivirus")).toBeInTheDocument();
    expect(screen.queryByText("Moteur absent")).not.toBeInTheDocument();
  });

  it("renders the real engine, signature, quarantine and traffic values", async () => {
    renderDashboard(installedEngine);

    expect(screen.getAllByText("Analyse manuelle prête").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ClamAV 1\.4\.3/).length).toBeGreaterThan(0);
    expect(screen.getByText("27000")).toBeInTheDocument();
  });
});
