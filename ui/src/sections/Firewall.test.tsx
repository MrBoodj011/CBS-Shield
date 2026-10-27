import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../lib/i18n";
import { api } from "../lib/api";
import { Firewall } from "./Firewall";

const observation = {
  status: {
    checkedAt: "2026-10-26T09:00:00Z",
    profiles: [
      { profile: "domaine", enabled: false, inboundDefault: "bloquer", outboundDefault: "autoriser" },
      { profile: "privé", enabled: false, inboundDefault: "bloquer", outboundDefault: "autoriser" },
      { profile: "public", enabled: false, inboundDefault: "bloquer", outboundDefault: "autoriser" },
    ],
    activeProfiles: [],
    rules: [
      {
        name: "Allow outbound app",
        grouping: "Applications",
        description: "Règle de référence",
        applicationName: "C:\\Apps\\example.exe",
        serviceName: "",
        direction: "sortant",
        action: "autoriser",
        enabled: true,
        protocol: "tcp",
        localPorts: "tout",
        remotePorts: "443",
        profiles: "tous",
      },
    ],
    rulesTotalCount: 1,
    rulesHash: "rules",
    profilesHash: "profiles",
    configurationHash: "configuration",
  },
  previousCheckedAt: "2026-10-25T09:00:00Z",
  changedSinceLast: true,
  changes: [{ code: "rules_changed", profile: null }],
  alerts: [
    { code: "all_profiles_disabled", severity: "danger", profile: null },
  ],
  listedTruncated: false,
};

const connections = {
  capturedAt: "2026-10-26T09:01:00Z",
  firewallCheckedAt: "2026-10-26T09:00:00Z",
  mappingAvailable: true,
  mappingLimited: false,
  rulesListed: 1,
  rulesTotalCount: 1,
  tcpTotal: 1,
  udpTotal: 2,
  rows: [
    {
      transport: "tcp",
      localEndpoint: "127.0.0.1:50123",
      remoteEndpoint: "93.184.216.34:443",
      state: "ESTABLISHED",
      pid: 4242,
      processName: "example.exe",
      processPath: "C:\\Apps\\example.exe",
      matchingRules: ["Allow outbound app"],
      matchingRuleCount: 1,
    },
  ],
  rowsTruncated: false,
  mappedRows: 1,
  unmappedRows: 0,
};

const management = {
  enabled: false,
  mutationApiExposed: false,
  backupDirectory: "C:\\Data\\firewall-backups",
  snapshotCount: 0,
  lastSnapshotAt: null,
  gates: [
    { code: "explicit_authorization", satisfied: false },
    { code: "isolated_vm_test", satisfied: false },
    { code: "backup_snapshot", satisfied: false },
    { code: "rollback_rehearsal", satisfied: false },
  ],
  rollbackDesignVersion: "1",
};

vi.mock("../lib/api", () => ({
  api: {
    firewallStatus: vi.fn(async () => observation),
    firewallConnections: vi.fn(async () => connections),
    firewallManagementStatus: vi.fn(async () => management),
    firewallAcknowledgeBaseline: vi.fn(async () => ({
      ...observation,
      changedSinceLast: false,
      changes: [],
    })),
    firewallExportSnapshot: vi.fn(async () => ({
      path: "C:\\Data\\firewall-backups\\firewall-snapshot-20261026T090000Z.json",
      rulesSaved: 1,
      rulesTotalCount: 1,
      truncated: false,
      checkedAt: "2026-10-26T09:00:00Z",
    })),
  },
  errorMessage: (error: unknown) => String(error),
}));

function renderFirewall() {
  return render(
    <I18nProvider language="fr">
      <Firewall />
    </I18nProvider>,
  );
}

describe("Firewall", () => {
  it("renders real alerts, connection mapping and the locked management gate", async () => {
    renderFirewall();

    expect(
      await screen.findByText("Tous les profils du pare-feu Windows sont désactivés"),
    ).toBeInTheDocument();
    expect(screen.getByText("Le jeu de règles a changé")).toBeInTheDocument();
    expect(await screen.findByText("example.exe")).toBeInTheDocument();
    expect(screen.getAllByText(/Allow outbound app/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Architecture verrouillée/)).toBeInTheDocument();
    expect(screen.getByText(/Aucune API de mutation n'est exposée/)).toBeInTheDocument();
    expect(screen.getByText("Restauration non implémentée")).toBeInTheDocument();
  });

  it("exports a read-only snapshot and acknowledges the baseline explicitly", async () => {
    renderFirewall();

    await screen.findByText(/Architecture verrouillée/);
    fireEvent.click(
      screen.getByRole("button", { name: /Exporter un instantané lecture seule/ }),
    );
    await waitFor(() => expect(api.firewallExportSnapshot).toHaveBeenCalledTimes(1));

    await screen.findByText(/firewall-snapshot-20261026T090000Z.json/);
    fireEvent.click(
      screen.getByRole("button", { name: /Accepter comme nouvelle référence/ }),
    );
    await waitFor(() =>
      expect(api.firewallAcknowledgeBaseline).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.queryByText("Le jeu de règles a changé")).not.toBeInTheDocument(),
    );
  });
});
