import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NetmonSnapshotPayload } from "../types";
import { NetworkMonitor } from "./NetworkMonitor";

// The Tauri IPC layer is out of scope here: we test the component against the
// exact payload shape produced by the backend commands.
const snapshotPayload: NetmonSnapshotPayload = {
  snapshot: {
    capturedAt: "2026-10-25T12:00:00Z",
    tcpConnections: [
      {
        transport: "tcp",
        localIp: "127.0.0.1",
        localPort: 49666,
        remoteIp: "93.184.216.34",
        remotePort: 443,
        state: "ESTABLISHED",
        pid: 4242,
        processName: "example-app.exe",
        processPath: "C:\\Apps\\example-app.exe",
      },
      {
        transport: "tcp",
        localIp: "0.0.0.0",
        localPort: 2222,
        remoteIp: null,
        remotePort: null,
        state: "LISTEN",
        pid: 4,
        processName: "System",
        processPath: null,
      },
      {
        transport: "tcp",
        localIp: "127.0.0.1",
        localPort: 4999,
        remoteIp: "2620:0:ccc::2",
        remotePort: 80,
        state: "TIME-WAIT",
        pid: 7,
        processName: null,
        processPath: null,
      },
    ],
    udpBindings: [
      {
        transport: "udp",
        localIp: "0.0.0.0",
        localPort: 5353,
        remoteIp: null,
        remotePort: null,
        state: null,
        pid: 12,
        processName: "dns-client.exe",
        processPath: "C:\\Apps\\dns-client.exe",
      },
    ],
    interfaces: [
      { alias: "Ethernet", interfaceType: "ethernet", rxBytes: 1000, txBytes: 2000 },
    ],
  },
  tcpTotal: 3,
  tcpEstablished: 1,
  udpTotal: 1,
  rxBytesDelta: 1500,
  txBytesDelta: 250,
  topProcesses: [{ name: "example-app.exe", connections: 1 }],
  historyRows: 0,
  persistenceError: null,
};

const netmonHistory = vi.fn(async (_limit: number) => []);
const netmonSnapshot = vi.fn(async () => snapshotPayload);

vi.mock("../lib/api", () => ({
  api: {
    netmonSnapshot: () => netmonSnapshot(),
    netmonHistory: (limit: number) => netmonHistory(limit),
  },
  errorMessage: (error: unknown) => String(error),
}));

describe("NetworkMonitor", () => {
  it("renders measured snapshot statistics without inventing content", async () => {
    render(<NetworkMonitor />);

    expect(await screen.findByText("example-app.exe")).toBeInTheDocument();
    expect(screen.getAllByText("ESTABLISHED").length).toBe(1);
    // "UDP" appears twice: the segmented filter button and the badge row.
    expect(screen.getAllByText("UDP").length).toBe(2);
    expect(screen.getByText("(4)")).toBeInTheDocument();
    // Deltas must be labelled honestly: measured between two captures.
    expect(screen.getByText(/pas des estimations/i)).toBeInTheDocument();
  });

  it("filters rows by transport and search query", async () => {
    render(<NetworkMonitor />);
    await screen.findByText("example-app.exe");
    expect(screen.getByText("(4)")).toBeInTheDocument();

    // UDP-only filter keeps the binding and hides the TCP rows.
    fireEvent.click(screen.getByRole("button", { name: "UDP" }));
    await waitFor(() => {
      expect(screen.getByText("dns-client.exe")).toBeInTheDocument();
      expect(screen.queryByText("System")).not.toBeInTheDocument();
      expect(screen.getByText("(1 affichées sur 4)")).toBeInTheDocument();
    });

    // Search by process name on the unfiltered view.
    fireEvent.click(screen.getByRole("button", { name: "Tout" }));
    fireEvent.change(screen.getByLabelText("Recherche locale"), {
      target: { value: "example-app" },
    });
    await waitFor(() => {
      expect(screen.getByText("(1 affichées sur 4)")).toBeInTheDocument();
      expect(screen.getByText("example-app.exe")).toBeInTheDocument();
    });
  });
});
