import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../lib/i18n";
import { Modal } from "./Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Modal open={open} title="Confirmation" onClose={() => setOpen(false)}>
        <button type="button">Premier</button>
        <button type="button">Dernier</button>
      </Modal>
    </div>
  );
}

describe("Modal accessibility", () => {
  it("traps Tab, labels the dialog and restores focus on close", async () => {
    render(
      <I18nProvider language="fr">
        <Harness />
      </I18nProvider>,
    );

    const opener = screen.getByRole("button", { name: "Ouvrir" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Confirmation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    const close = screen.getByRole("button", { name: "Fermer" });
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Dernier" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
