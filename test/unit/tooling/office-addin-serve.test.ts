import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { fileFor } from "../../../tooling/scripts/office-addin-serve";

/**
 * Dev-servern (#1077) serverar en katalog över HTTPS. Sökvägsupplösningen är
 * den enda logiken i den — och den enda som kan läcka filer utanför `dist/`.
 * Servern är kortlivad och lokal, men "lokal" är inte samma sak som "får läsa
 * hela disken".
 */
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-addin-"));
  writeFileSync(join(root, "taskpane.html"), "<html>");
  writeFileSync(join(root, "taskpane.js"), "//");
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "icon-64.png"), "png");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("fileFor", () => {
  // Office begär `/` när panelen öppnas — utan default-dokument blir den tom.
  it("löser / till taskpane.html", () => {
    expect(fileFor("/", root)).toBe(join(root, "taskpane.html"));
  });

  it("löser en vanlig fil", () => {
    expect(fileFor("/taskpane.js", root)).toBe(join(root, "taskpane.js"));
  });

  it("löser en fil i undermapp", () => {
    expect(fileFor("/assets/icon-64.png", root)).toBe(join(root, "assets", "icon-64.png"));
  });

  // Office lägger på cache-busters; de hör inte till filnamnet.
  it("ignorerar query-strängen", () => {
    expect(fileFor("/taskpane.js?v=123", root)).toBe(join(root, "taskpane.js"));
  });

  it("avkodar procent-escapade sökvägar", () => {
    writeFileSync(join(root, "med mellanslag.js"), "//");
    expect(fileFor("/med%20mellanslag.js", root)).toBe(join(root, "med mellanslag.js"));
  });

  it("ger null för en fil som inte finns", () => {
    expect(fileFor("/finns-inte.js", root)).toBeNull();
  });

  // ── Sökvägsrymning ────────────────────────────────────────────────────
  it("vägrar ../ ut ur roten", () => {
    expect(fileFor("/../../package.json", root)).toBeNull();
  });

  it("vägrar procent-kodad ../ (annars kringgås filtret)", () => {
    expect(fileFor("/%2e%2e/%2e%2e/package.json", root)).toBeNull();
  });

  it("vägrar ../ mitt i sökvägen", () => {
    expect(fileFor("/assets/../../package.json", root)).toBeNull();
  });

  /**
   * En syskonkatalog med samma prefix (`dist-hemligt` mot `dist`) skulle
   * passera en naiv `startsWith` — därför jämförs mot den normaliserade
   * absoluta sökvägen och inte mot strängen i requesten.
   */
  it("vägrar en syskonkatalog med samma prefix", () => {
    const sibling = `${root}-hemligt`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "x.js"), "//");
    try {
      expect(fileFor("/../" + join(sibling, "x.js").split("/").pop()!, root)).toBeNull();
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});
