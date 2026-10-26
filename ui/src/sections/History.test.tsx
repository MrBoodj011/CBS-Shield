import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../lib/i18n";
import type { ScanDetails, ScanRecord } from "../types";
import { History } from "./History";

const cleanScan: ScanRecord = {
  id: 1,
  uuid: "11111111-1111-1111-1111-111111111111",
  startedAt: "2026-10-20T10:00:00Z",
  finishedAt: "2026-10-20T10:01:00Z",
  durationMs: 60_000,
  targets: ["C:\\Users\\adjar\\Documents"],
  filesScanned: 1200,
  infectedFiles: 0,
  errorCount: 0,
  outcome: "clean",
  cancelled: false,
  engineVersion: "1.4.3",
  signatureVersion: "27000",
  fatalError: null,
};

const detectedScan: ScanRecord = {
  ...cleanScan,
  id: 2,
  uuid: "22222222-2222-2222-2222-222222222222",
  startedAt: "2026-10-21T10:00:00Z",
  finishedAt: "2026-10-21T10:02:00Z",
  targets: ["C:\\Users\\adjar\\Downloads"],
  filesScanned: 40,
  infectedFiles: 1,
  outcome: "detected",
};

const details: ScanDetails = {
  scan: detectedScan,
  detections: [
    {
      id: 9,
      scanId: 2,
      filePath: "C:\\Users\\adjar\\Downloads\\eicar.com",
      threatName: "Eicar-Test-Signature",
      fileSizeBytes: 68,
      sha256: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    },
  ],
};

vi.mock("../lib/api", () => ({
  api: {
    listScans: vi.fn(async () => [detectedScan, cleanScan]),
    getScanDetails: vi.fn(async () => details),
  },
  errorMessage: (error: unknown) => String(error),
}));

function renderHistory() {
  return render(
    <I18nProvider language="fr">
      <History onNavigate={() => undefined} />
    </I18nProvider>,
  );
}

describe("History", () => {
  it("renders the persisted scans and filters them by outcome", async () => {
    renderHistory();

    expect(await screen.findByText("C:\\Users\\adjar\\Documents")).toBeInTheDocument();
    expect(screen.getByText(/2 scan\(s\) affiché\(s\) sur 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Propres" }));
    await waitFor(() => {
      expect(screen.queryByText("C:\\Users\\adjar\\Downloads")).not.toBeInTheDocument();
      expect(screen.getByText(/1 scan\(s\) affiché\(s\) sur 2/)).toBeInTheDocument();
    });
  });

  it("opens the stored detections in the report modal", async () => {
    renderHistory();
    await screen.findByText("C:\\Users\\adjar\\Documents");

    const buttons = screen.getAllByRole("button", { name: "Détails" });
    fireEvent.click(buttons[0]);

    expect(await screen.findByText("Eicar-Test-Signature")).toBeInTheDocument();
    expect(screen.getByText(/eicar\.com/)).toBeInTheDocument();
  });
});
