import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../lib/i18n";
import type { QuarantineRecord } from "../types";
import { Quarantine } from "./Quarantine";

const base: QuarantineRecord = {
  id: 1,
  itemId: "item-1",
  fileName: "fixture.txt",
  originalPath: "C:\\Users\\cbs\\Desktop\\fixture.txt",
  storedPath: "C:\\vault\\item-1.cbsq",
  sha256: "a".repeat(64),
  sizeBytes: 32,
  threatName: "CBS93_Synthetic.UNOFFICIAL",
  status: "active",
  createdAt: "2026-10-30T10:00:00Z",
  restoredAt: null,
  sourceScanId: null,
};

function renderVault(items: QuarantineRecord[]) {
  return render(
    <I18nProvider language="fr">
      <Quarantine items={items} settings={null} loading={false} onRefresh={async () => undefined} />
    </I18nProvider>,
  );
}

describe("Quarantine", () => {
  it("keeps restore and purge available for a recoverable item", () => {
    renderVault([{ ...base, status: "pending" }]);
    expect(screen.getByText("Récupérable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restaurer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supprimer/ })).toBeInTheDocument();
  });

  it("counts a recoverable item as active in the vault header", () => {
    renderVault([{ ...base, status: "pending" }]);
    expect(screen.getByText("1 actif")).toBeInTheDocument();
  });

  it("hides actions for a restored item", () => {
    renderVault([{ ...base, status: "restored", restoredAt: "2026-10-30T11:00:00Z" }]);
    expect(screen.queryByRole("button", { name: /Restaurer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Supprimer/ })).not.toBeInTheDocument();
  });
});
