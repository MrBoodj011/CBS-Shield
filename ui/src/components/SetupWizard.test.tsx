import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../lib/i18n";
import { api } from "../lib/api";
import type { EngineStatus, SettingsView } from "../types";
import { SetupWizard } from "./SetupWizard";

const missingEngine: EngineStatus = {
  installed: false,
  clamscanPath: null,
  freshclamPath: null,
  sigtoolPath: null,
  engineVersion: null,
  signatureVersion: null,
  signatureDate: null,
  signatureAgeDays: null,
  signatureState: "missing",
  databasePath: null,
  databaseFileCount: 0,
  checkedAt: "2026-10-26T09:00:00Z",
  message: "ClamAV introuvable.",
};

const installedEngine: EngineStatus = {
  ...missingEngine,
  installed: true,
  clamscanPath: "C:\\Program Files\\ClamAV\\clamscan.exe",
  freshclamPath: "C:\\Program Files\\ClamAV\\freshclam.exe",
  sigtoolPath: "C:\\Program Files\\ClamAV\\sigtool.exe",
  engineVersion: "1.5.4",
  signatureVersion: "28165",
  signatureDate: "2026-10-25",
  signatureAgeDays: 1,
  signatureState: "upToDate",
  databasePath: "C:\\Users\\adjar\\AppData\\Local\\Cybrense\\CBS Shield\\clamav\\database",
  databaseFileCount: 3,
  message: "ClamAV 1.5.4, signatures à jour.",
};

const settings: SettingsView = {
  theme: "dark",
  language: "fr",
  recursive: true,
  includePua: false,
  clamscanPath: null,
  databasePath: null,
  signatureMaxAgeDays: 7,
  autoUpdate: false,
  autoUpdateHours: 24,
  onboardingCompleted: false,
  dataDir: "C:\\Users\\adjar\\AppData\\Local\\Cybrense\\CBS Shield",
  historyPath: "C:\\history.db",
  quarantinePath: "C:\\quarantine",
  signatureDbPath: "C:\\database",
  freshclamConfPath: "C:\\freshclam.conf",
  appVersion: "0.7.0-dev",
};

const inventory = {
  databaseDir: installedEngine.databasePath,
  sigtoolAvailable: true,
  officialComponents: [
    {
      file: "daily.cld",
      version: "28165",
      signatures: 3_642_895,
      buildTime: "2026-10-25T08:00:00Z",
      verified: true,
      md5: "abc",
    },
  ],
  officialSignatures: 3_642_895,
  customSignatureFiles: [],
  customSignatures: 0,
  checkedAt: "2026-10-26T09:00:00Z",
  notes: ["Base officielle vérifiée par sigtool."],
};

const firewallStatus = {
  status: {
    checkedAt: "2026-10-26T09:00:00Z",
    profiles: [
      { profile: "domaine", enabled: true, inboundDefault: "bloquer", outboundDefault: "autoriser" },
      { profile: "privé", enabled: true, inboundDefault: "bloquer", outboundDefault: "autoriser" },
      { profile: "public", enabled: true, inboundDefault: "bloquer", outboundDefault: "autoriser" },
    ],
    activeProfiles: ["privé"],
    rules: [],
    rulesTotalCount: 0,
    rulesHash: "rules",
    profilesHash: "profiles",
    configurationHash: "configuration",
  },
  previousCheckedAt: "2026-10-25T09:00:00Z",
  changedSinceLast: false,
  changes: [],
  alerts: [],
  listedTruncated: false,
};

vi.mock("../lib/api", () => ({
  api: {
    signatureInventory: vi.fn(async () => inventory),
    provisioningStatus: vi.fn(async () => ({
      wingetAvailable: true,
      wingetVersion: "v1.11.430",
      clamavInstalled: false,
      clamscanPath: null,
      databasePath: null,
      installCommand:
        "winget install --id Cisco.ClamAV --exact --source winget --interactive --accept-package-agreements --accept-source-agreements",
      probeCommand: "winget list --id Cisco.ClamAV --exact",
      docsUrl: "https://www.clamav.net/downloads",
      licenseNote: "ClamAV est publié sous licence GPLv2 par Cisco Talos.",
      checkedAt: "2026-10-26T09:00:00Z",
    })),
    firewallStatus: vi.fn(async () => firewallStatus),
    netmonHistory: vi.fn(async () => []),
    updateLogs: vi.fn(async () => ({
      appLogPath: "C:\\logs\\app.log",
      freshclamLogPath: "C:\\logs\\freshclam.log",
      appLines: [],
      freshclamLines: [],
    })),
    engineStatus: vi.fn(async () => installedEngine),
    updateSettings: vi.fn(async () => settings),
    installClamav: vi.fn(async () => ({
      attempted: true,
      success: true,
      outcome: "installed",
      exitCode: 0,
      installed: true,
      message: "ClamAV est maintenant détecté.",
      engine: installedEngine,
    })),
    updateSignatures: vi.fn(),
    openDocumentation: vi.fn(),
  },
  errorMessage: (error: unknown) =>
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error),
  errorCode: (error: unknown) =>
    typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : null,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

function renderWizard(engine: EngineStatus | null) {
  return render(
    <I18nProvider language="fr">
      <SetupWizard
        open
        engine={engine}
        settings={settings}
        onClose={() => undefined}
        onCompleted={() => undefined}
        onEngineChanged={() => undefined}
        onSettingsChanged={() => undefined}
        onNavigate={() => undefined}
      />
    </I18nProvider>,
  );
}

describe("SetupWizard", () => {
  it("requires explicit authorization before launching the official install", async () => {
    renderWizard(missingEngine);

    expect(await screen.findByRole("heading", { level: 1, name: "Bienvenue" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    expect(
      await screen.findByText("ClamAV absent — analyses manuelles indisponibles"),
    ).toBeInTheDocument();
    const installButton = screen.getByRole("button", {
      name: /Installer ClamAV avec mon accord/,
    });
    expect(installButton).toBeDisabled();
    expect(screen.queryByText(/winget install/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/terminal/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(installButton).toBeEnabled();
    fireEvent.click(installButton);

    await waitFor(() => expect(api.installClamav).toHaveBeenCalledWith(true));
  });

  it("maps an unavailable installer to a friendly recovery path", async () => {
    vi.mocked(api.installClamav).mockRejectedValueOnce({
      code: "wingetUnavailable",
      message: "winget introuvable",
    });
    renderWizard(missingEngine);

    fireEvent.click(await screen.findByRole("button", { name: /Continuer/ }));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Installer ClamAV avec mon accord/ }));

    expect(
      await screen.findByText(/composant Windows qui installe les applications \(winget\) est indisponible/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/winget introuvable/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Localiser clamscan.exe/ }).length).toBeGreaterThan(0);
  });

  it("shows the real verified signature inventory", async () => {
    renderWizard(installedEngine);

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
    await screen.findByText("ClamAV détecté");
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    expect(await screen.findByText("daily.cld")).toBeInTheDocument();
    expect(screen.getByText("3 642 895")).toBeInTheDocument();
    expect(screen.getByText("Base officielle détectée")).toBeInTheDocument();
    expect(screen.getAllByText("Vérifiée").length).toBeGreaterThan(0);
  });

  it("does not mark the firewall check green when alerts exist", async () => {
    vi.mocked(api.firewallStatus).mockResolvedValueOnce({
      ...firewallStatus,
      alerts: [{ code: "all_profiles_disabled", severity: "danger", profile: null }],
    });
    renderWizard(installedEngine);

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
    await screen.findByRole("heading", { level: 1, name: "Moteur antivirus" });
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
    await screen.findByRole("heading", { level: 1, name: "Signatures" });
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
    await screen.findByRole("heading", { level: 1, name: "Protection réseau" });
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
    await screen.findByRole("heading", { level: 1, name: "Récapitulatif" });

    expect(
      await screen.findByText(/1 alerte\(s\) de sécurité observée\(s\)/),
    ).toBeInTheDocument();
  });
});
