/** Statusfönstret (status-page.ts): texter, knappar och åtgärdslänkar. */

import { describe, expect, test } from "bun:test";

import type { UpdateStatus } from "../src/engine/update.ts";
import { parseAction, statusPageHtml, type StatusPageModel } from "../src/status-page.ts";
import { trayView } from "../src/tray-status.ts";

const NOW = new Date("2026-11-16T10:00:00");
const AT = new Date("2026-11-16T09:30:00");
const IDLE: UpdateStatus = { checking: false, notice: null, last: null };

function page(over: Partial<StatusPageModel> = {}): string {
  return statusPageHtml({
    version: "v0.7.25", update: IDLE, sync: trayView(true, null), login: "logged-in",
    openAtLogin: true, canInstall: true, installing: false, ...over,
  }, NOW);
}

describe("parseAction", () => {
  test("kända åtgärder", () => {
    expect(parseAction("ava:check-update")).toBe("check-update");
    expect(parseAction("ava:install")).toBe("install");
  });
  test("okända och andra scheman → null", () => {
    expect(parseAction("ava:rm-rf")).toBeNull();
    expect(parseAction("https://evil.example/ava:install")).toBeNull();
  });
});

describe("statusPageHtml — uppdatering", () => {
  test("inte kontrollerad än + sök-knapp", () => {
    const html = page();
    expect(html).toContain("Version v0.7.25");
    expect(html).toContain("Inte kontrollerad än");
    expect(html).toContain('href="ava:check-update"');
  });
  test("pågår → ingen knapp", () => {
    const html = page({ update: { ...IDLE, checking: true } });
    expect(html).toContain("Söker efter uppdatering…");
    expect(html).not.toContain('href="ava:check-update"');
  });
  test("senaste versionen med klockslag", () => {
    expect(page({ update: { ...IDLE, last: { at: AT, result: "up-to-date" } } })).toContain("Du har senaste versionen (kl 09:30)");
  });
  test("fel", () => {
    expect(page({ update: { ...IDLE, last: { at: AT, result: "error" } } })).toContain("Kunde inte söka");
  });
  test("ny version → Uppdatera nu", () => {
    const update = { ...IDLE, notice: { version: "v0.7.26", url: "u" }, last: { at: AT, result: "available" as const } };
    const html = page({ update });
    expect(html).toContain("Ny version finns: v0.7.26");
    expect(html).toContain('href="ava:install"');
    expect(page({ update, canInstall: false })).toContain('href="ava:download"');
  });
  test("uppdaterar → appen startar om", () => {
    expect(page({ installing: true })).toContain("Uppdaterar… AVA Helper startar om strax.");
  });
  test("taggnamn escapas", () => {
    expect(page({ update: { ...IDLE, notice: { version: "<b>", url: "u" } } })).toContain("&#60;b&#62;");
  });
});

describe("statusPageHtml — synk, inloggning, start", () => {
  test("synk", () => {
    expect(page()).toContain("Allt synkat");
    expect(page({ sync: trayView(false, null) })).toContain("Inte igång");
    expect(page({ sync: trayView(true, { pending: 2, conflict: 0, total: 2, entries: [] }) })).toContain("2 ändring(ar) väntar");
  });
  test("inloggning", () => {
    expect(page()).toContain("Inloggad");
    expect(page({ login: "logged-out" })).toContain('href="ava:login"');
    expect(page({ login: "not-configured" })).toContain("öppna AVA i webbläsaren");
  });
  test("starta vid inloggning", () => {
    expect(page()).toContain("Stäng av");
    expect(page({ openAtLogin: false })).toContain("Slå på");
  });
});
