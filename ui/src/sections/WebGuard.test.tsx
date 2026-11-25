import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../components/Toasts";
import { I18nProvider } from "../lib/i18n";
import { api } from "../lib/api";
import type { WebGuardView } from "../types";
import { WebGuard } from "./WebGuard";

function snapshot(overrides: Partial<WebGuardView> = {}): WebGuardView {
  return {
    checkedAt: "2026-10-28T10:00:00Z",
    health: {
      checkedAt: "2026-10-28T10:00:00Z",
      service: "running",
      serviceObservable: true,
      adapters: [
        {
          name: "Ethernet",
          description: "Intel(R) Ethernet",
          interfaceKind: "ethernet",
          up: true,
          dnsServers: ["192.0.2.53"],
          dnsSuffix: "example.test",
          probableVpn: false,
        },
        {
          name: "VPN",
          description: "WireGuard tunnel",
          interfaceKind: "tunnel",
          up: false,
          dnsServers: ["10.8.0.1"],
          dnsSuffix: "",
          probableVpn: true,
        },
      ],
      resolvers: ["192.0.2.53", "10.8.0.1"],
      probableVpn: true,
      encryptedDnsEvidence: false,
      proxyConfigured: null,
      healthy: true,
      readOnly: true,
    },
    proxy: {
      running: false,
      endpoint: "127.0.0.1:5353",
      mode: "prototype",
      startedAt: null,
      lastError: null,
      systemDnsModified: false,
      activeEnforcement: false,
    },
    counts: {
      blocklist: 42,
      allowlist: 2,
      filters: 1,
      malware: 30,
      phishing: 12,
      events: 3,
      blockedEvents: 2,
      allowedEvents: 1,
      errorEvents: 0,
    },
    filters: [
      {
        id: "source-1",
        name: "local-hosts.txt",
        category: "malware",
        importedAt: "2026-10-28T09:00:00Z",
        entryCount: 42,
        sha256: "a".repeat(64),
      },
    ],
    events: [
      {
        id: "event-1",
        occurredAt: "2026-10-28T09:30:00Z",
        domain: "malware.test",
        action: "blocked",
        category: "malware",
        matchedRule: "malware.test",
        source: "local-hosts.txt",
        upstream: null,
        latencyMs: 0,
        detail: "Réponse NXDOMAIN locale, requête non transmise.",
      },
    ],
    allowlist: [
      {
        domain: "safe.example.test",
        note: "Faux positif vérifié",
        addedAt: "2026-10-28T09:10:00Z",
      },
    ],
    blocklist: [
      {
        domain: "malware.test",
        category: "malware",
        source: "local-hosts.txt",
        importedAt: "2026-10-28T09:00:00Z",
      },
    ],
    blocklistTotal: 42,
    blocklistTruncated: false,
    stateError: null,
    systemDnsModified: false,
    restorationRequired: false,
    activeEnforcement: false,
    limitationCodes: [
      "loopbackOnly",
      "noHttpsInterception",
      "encryptedDnsBypass",
      "vpnBypass",
      "notSystemWide",
      "noMalwareGuarantee",
    ],
    ...overrides,
  };
}

vi.mock("../lib/api", () => ({
  api: {
    webguardSnapshot: vi.fn(),
    webguardStartMonitor: vi.fn(),
    webguardStopMonitor: vi.fn(),
    webguardTestDomain: vi.fn(),
    webguardImportFilter: vi.fn(),
    webguardAddAllowlist: vi.fn(),
    webguardRemoveAllowlist: vi.fn(),
    webguardClearHistory: vi.fn(),
    webguardClearBlocklist: vi.fn(),
  },
  errorMessage: (error: unknown) =>
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error),
}));

function renderWebGuard() {
  return render(
    <I18nProvider language="fr">
      <ToastProvider>
        <WebGuard />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("WebGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.webguardSnapshot).mockResolvedValue(snapshot());
    vi.mocked(api.webguardStartMonitor).mockResolvedValue(
      snapshot({
        proxy: {
          running: true,
          endpoint: "127.0.0.1:5353",
          mode: "prototype",
          startedAt: "2026-10-28T10:01:00Z",
          lastError: null,
          systemDnsModified: false,
          activeEnforcement: false,
        },
      }),
    );
    vi.mocked(api.webguardStopMonitor).mockResolvedValue(snapshot());
  });

  it("shows eight views and never presents the stopped prototype as active protection", async () => {
    renderWebGuard();

    expect(
      await screen.findByRole("heading", {
        name: /Prototype arrêté — aucun filtrage DNS actif/,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getAllByText(/DNS système non modifié/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Aucune interception HTTPS/)).toBeInTheDocument();
    expect(screen.queryByText(/protection complète/i)).not.toBeInTheDocument();
  });

  it("starts the loopback prototype and updates the observed state", async () => {
    renderWebGuard();

    const start = await screen.findByRole("button", { name: /Démarrer le prototype/ });
    fireEvent.click(start);

    await waitFor(() => expect(api.webguardStartMonitor).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("heading", { name: /Prototype actif sur loopback/ }),
    ).toBeInTheDocument();
  });

  it("runs a real domain evaluation and renders the backend verdict", async () => {
    vi.mocked(api.webguardTestDomain).mockResolvedValue({
      domain: "malware.test",
      verdict: {
        action: "blocked",
        reason: "blocklist",
        category: "malware",
        matchedRule: "malware.test",
        allowlistRule: null,
      },
      proxyRunning: true,
      endpoint: "127.0.0.1:5353",
      queryOutcome: "blocked",
      rcode: 3,
      latencyMs: 1,
      detail: "Réponse NXDOMAIN locale, requête non transmise.",
    });
    renderWebGuard();

    const domain = await screen.findByDisplayValue("example.com");
    fireEvent.change(domain, { target: { value: "malware.test" } });
    fireEvent.click(screen.getByRole("button", { name: /^Évaluer$/ }));

    await waitFor(() =>
      expect(api.webguardTestDomain).toHaveBeenCalledWith("malware.test"),
    );
    expect(await screen.findByText("NXDOMAIN")).toBeInTheDocument();
    expect(screen.getByText(/Correspondance dans la liste de blocage/)).toBeInTheDocument();
  });

  it("adds a documented allowlist exception through the safe control", async () => {
    vi.mocked(api.webguardAddAllowlist).mockResolvedValue(
      snapshot({
        counts: { ...snapshot().counts, allowlist: 3 },
        allowlist: [
          ...snapshot().allowlist,
          {
            domain: "service.example.com",
            note: "Faux positif vérifié",
            addedAt: "2026-10-28T10:02:00Z",
          },
        ],
      }),
    );
    renderWebGuard();

    fireEvent.click(await screen.findByRole("tab", { name: /Autorisations/ }));
    fireEvent.change(screen.getByPlaceholderText("service.example.com"), {
      target: { value: "service.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Faux positif vérifié/), {
      target: { value: "Faux positif vérifié" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Autoriser ce domaine/ }));

    await waitFor(() =>
      expect(api.webguardAddAllowlist).toHaveBeenCalledWith(
        "service.example.com",
        "Faux positif vérifié",
      ),
    );
    expect(await screen.findByText("service.example.com")).toBeInTheDocument();
  });

  it("labels DNS diagnostics as read-only and shows real adapters", async () => {
    renderWebGuard();

    fireEvent.click(await screen.findByRole("tab", { name: /Diagnostic DNS/ }));
    expect(await screen.findByText("Intel(R) Ethernet")).toBeInTheDocument();
    expect(screen.getAllByText("192.0.2.53").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lecture seule/).length).toBeGreaterThan(0);
    expect(screen.getByText(/WireGuard tunnel/)).toBeInTheDocument();
  });
});
