import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnavailablePanel } from "./UnavailablePanel";

describe("UnavailablePanel", () => {
  it("states clearly that the feature is unavailable", () => {
    render(
      <UnavailablePanel
        title="Pare-feu applicatif"
        description="Aucune règle système n'est modifiée."
        features={["Visualisation des règles", "Journalisation des changements"]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pare-feu applicatif" })).toBeInTheDocument();
    expect(screen.getByText("Non disponible")).toBeInTheDocument();
    expect(screen.getByText("Aucune règle système n'est modifiée.")).toBeInTheDocument();
    expect(screen.getByText("Visualisation des règles")).toBeInTheDocument();
    expect(screen.getByText("Journalisation des changements")).toBeInTheDocument();
  });

  it("allows a custom status label without pretending the feature works", () => {
    render(
      <UnavailablePanel
        title="Moniteur réseau"
        description="Aucune capture."
        features={["Connexions actives"]}
        statusLabel="Phase 2"
      />,
    );

    expect(screen.getByText("Phase 2")).toBeInTheDocument();
    expect(screen.queryByText("Non disponible")).not.toBeInTheDocument();
  });
});
