import { describe, expect, it } from "vitest";

import { translate } from "./i18n";

describe("i18n", () => {
  it("translates shell and dashboard keys in both languages", () => {
    expect(translate("fr", "nav.dashboard")).toBe("Dashboard");
    expect(translate("en", "nav.history")).toBe("Scan history");
    expect(translate("fr", "dashboard.stat.scans")).toBe("Scans réalisés");
    expect(translate("en", "dashboard.stat.scans")).toBe("Scans run");
  });

  it("interpolates variables without touching unknown placeholders", () => {
    expect(translate("fr", "dashboard.event.scanThreats", { count: 3 })).toBe(
      "3 menace(s) détectée(s)",
    );
    expect(translate("en", "common.days", { count: 12 })).toBe("12 d");
    expect(translate("fr", "dashboard.version", { version: "0.3.0-dev" })).toBe(
      "Version 0.3.0-dev",
    );
  });

  it("falls back to the French dictionary and then to the key itself", () => {
    expect(translate("en", "outcome.clean")).toBe("Clean");
    // Unknown keys must never crash a render, even if a section forgets a key.
    expect(translate("fr", "unknown.key" as never)).toBe("unknown.key");
  });
});
