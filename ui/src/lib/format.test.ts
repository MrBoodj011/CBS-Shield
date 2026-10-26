import { describe, expect, it } from "vitest";

import {
  fileBaseName,
  formatBytes,
  formatDuration,
  formatNumber,
  outcomeLabel,
  outcomeTone,
  setFormatLanguage,
  signatureStateLabel,
  signatureStateTone,
  truncateMiddle,
} from "./format";

describe("format helpers", () => {
  it("formats durations without inventing precision", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(1500)).toBe("1,5 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats byte sizes in French units", () => {
    expect(formatBytes(68)).toBe("68 o");
    expect(formatBytes(2048)).toBe("2 Ko");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 Mo");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("switches numbers, dates and labels to English", () => {
    setFormatLanguage("en");
    expect(formatNumber(12_345)).toMatch(/12,345/);
    expect(formatBytes(2048)).toBe("2 KB");
    expect(outcomeLabel("clean")).toBe("No threat");
    setFormatLanguage("fr");
  });

  it("labels scan outcomes honestly", () => {
    expect(outcomeLabel("detected")).toBe("Menaces détectées");
    expect(outcomeLabel("clean")).toBe("Aucune menace");
    expect(outcomeLabel("unknown")).toBe("unknown");
    expect(outcomeTone("detected")).toBe("danger");
    expect(outcomeTone("clean")).toBe("ok");
  });

  it("maps signature states to labels and tones", () => {
    expect(signatureStateLabel("missing")).toBe("Absentes");
    expect(signatureStateLabel("upToDate")).toBe("À jour");
    expect(signatureStateTone("missing")).toBe("danger");
    expect(signatureStateTone("outdated")).toBe("warning");
  });

  it("truncates long paths and extracts basenames", () => {
    expect(truncateMiddle("short", 20)).toBe("short");
    expect(truncateMiddle("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcd…vwxyz");
    expect(fileBaseName("C:\\Users\\me\\eicar.com")).toBe("eicar.com");
    expect(fileBaseName("/home/me/file.txt")).toBe("file.txt");
  });

  it("formats numbers with French grouping", () => {
    expect(formatNumber(12_345)).toMatch(/12\s345/);
    expect(formatNumber(null)).toBe("—");
  });
});
