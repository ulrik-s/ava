/**
 * Spärren mot moduler som bara tester använder (#1764): en ny flaggad modul
 * fäller, en baslinjepost som inte längre flaggas måste tas bort, och
 * baslinjen kan bara skärpas — aldrig luckras upp.
 */
import { describe, expect, it } from "vitest-compat";
import { checkProductionOnlyFiles, parseKnipReport, tightenBaseline } from "../../tooling/scripts/knip-production-ratchet";

describe("checkProductionOnlyFiles", () => {
  it("samma mängd i båda: grönt", () => {
    expect(checkProductionOnlyFiles(["src/a.ts", "src/b.ts"], ["src/b.ts", "src/a.ts"])).toEqual({ violations: [], stale: [] });
  });

  it("en flaggad fil som inte står i baslinjen är ett brott", () => {
    expect(checkProductionOnlyFiles(["src/ny.ts"], []).violations).toEqual([
      "src/ny.ts: modulen används bara av tester: radera den, eller använd den i produktionskoden",
    ]);
  });

  it("en baslinjefil som inte flaggas längre ber om --update", () => {
    expect(checkProductionOnlyFiles([], ["src/borta.ts"]).stale).toEqual([
      "src/borta.ts: flaggas inte längre — kör: bun run knip:production --update",
    ]);
  });
});

describe("tightenBaseline", () => {
  it("tar bort det som inte flaggas längre, behåller ordningen och lägger aldrig till", () => {
    const baseline = ["src/c.ts", "src/borta.ts", "src/a.ts"];
    expect(tightenBaseline(["src/a.ts", "src/c.ts", "src/ny.ts"], baseline)).toEqual(["src/c.ts", "src/a.ts"]);
  });
});

describe("parseKnipReport", () => {
  it("en giltig rapport (knip avslutade med exit 1) ger de flaggade filerna, sorterade", () => {
    const stdout = JSON.stringify({
      issues: [
        { file: "src/z.ts", owners: [], files: [{ name: "src/z.ts" }] },
        { file: "src/a.ts", owners: [], files: [{ name: "src/a.ts" }] },
      ],
    });
    expect(parseKnipReport(stdout, "")).toEqual(["src/a.ts", "src/z.ts"]);
  });

  it("tom stdout ger ett fel som innehåller stderr", () => {
    expect(() => parseKnipReport("", "ERROR: hittar inte konfigurationen")).toThrow(
      /^knip gav ingen läsbar rapport[\s\S]*hittar inte konfigurationen/,
    );
  });

  it("text som inte är JSON ger ett fel", () => {
    expect(() => parseKnipReport("Unused files (1)", "")).toThrow(/^knip gav ingen läsbar rapport/);
  });

  it("JSON i fel form ger ett fel", () => {
    expect(() => parseKnipReport(JSON.stringify({ issues: [{ file: "src/a.ts" }] }), "")).toThrow(/^knip gav ingen läsbar rapport/);
  });
});
