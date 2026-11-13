/**
 * #1578: versionstexten `v<version> · <datum>` (dag, kort månad utan punkt, år
 * i Stockholmstid).
 */
import { describe, expect, it } from "vitest-compat";
import { formatAppVersion } from "@/lib/shared/app-version";

describe("formatAppVersion", () => {
  it("taggad version + datum → `v0.7.11 · 13 nov 2026` (ICU:s `nov.` blir `nov`)", () => {
    expect(formatAppVersion("v0.7.11", "2026-11-13T08:16:45+01:00")).toBe("v0.7.11 · 13 nov 2026");
  });

  it("tar bort punkten i alla förkortade månader", () => {
    expect(formatAppVersion("v1.0.0", "2026-02-03T12:00:00Z")).toBe("v1.0.0 · 3 feb 2026");
    expect(formatAppVersion("v1.0.0", "2026-09-30T12:00:00Z")).toBe("v1.0.0 · 30 sep 2026");
  });

  it("otaggad `git describe`-sträng visas som den är", () => {
    expect(formatAppVersion("v0.7.11-3-gabc1234", "2026-06-01T10:00:00Z")).toBe("v0.7.11-3-gabc1234 · 1 juni 2026");
  });

  it("dubblerar inte ett inledande v, men lägger till ett som saknas", () => {
    expect(formatAppVersion("0.7.11", "2026-11-13T12:00:00Z")).toBe("v0.7.11 · 13 nov 2026");
  });

  it("saknad version → tom text", () => {
    expect(formatAppVersion("", "2026-11-13T12:00:00Z")).toBe("");
    expect(formatAppVersion("   ", "")).toBe("");
  });

  it("saknat eller ogiltigt datum → bara versionen", () => {
    expect(formatAppVersion("v0.7.11", "")).toBe("v0.7.11");
    expect(formatAppVersion("v0.7.11", "inte-ett-datum")).toBe("v0.7.11");
  });

  it("nära midnatt UTC avgör Stockholmstid dagen", () => {
    // 23:30 UTC 13 nov = 00:30 14 nov i Stockholm (vintertid, +01:00).
    expect(formatAppVersion("v0.7.11", "2026-11-13T23:30:00Z")).toBe("v0.7.11 · 14 nov 2026");
    // 22:30 UTC 30 jun = 00:30 1 jul i Stockholm (sommartid, +02:00).
    expect(formatAppVersion("v0.7.11", "2026-06-30T22:30:00Z")).toBe("v0.7.11 · 1 juli 2026");
  });
});
