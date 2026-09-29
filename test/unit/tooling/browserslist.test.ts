/**
 * Webbläsarstödet (#1299) — policy och byggmål.
 *
 * POLICYN: de två senaste versionerna av Chrome, Edge, Firefox och Safari på
 * desktop, samt Safari och Chrome på iOS. Chrome på iOS använder WebKit och
 * ingår därför i `ios_saf` (browserslist har ingen egen post för den).
 *
 * BYGGMÅLEN (`browserslist` i package.json) är lägre versioner av samma
 * webbläsare. Next 16 bygger med Turbopack, vars inbyggda webbläsardata inte
 * känner till de allra nyaste versionerna (Chrome 146+ i 16.3.x). Med
 * "last 2 … versions" som mål tolkades de som okända och bygget skrev om
 * nästan all modern syntax (class, ??, async) till gammal — ~11 % större
 * klient-JS. Kod byggd för en äldre version körs på alla nyare, så lägre mål
 * täcker policyn.
 */
import browserslist from "browserslist";
import { describe, expect, it } from "vitest-compat";

/** Policyn: de webbläsare och versioner AVA stöder. */
const POLICY = ["last 2 Chrome versions", "last 2 Edge versions", "last 2 Firefox versions", "last 2 Safari versions", "last 2 iOS versions"];
const FAMILIES = ["chrome", "edge", "firefox", "ios_saf", "safari"];

/** Det bygget riktar sig mot: konfigurationen i package.json. */
const targets = browserslist(undefined, { path: process.cwd() });
const familyOf = (t: string): string => t.split(" ")[0] ?? "";
/** Lägsta version (första delen av t.ex. "18.5-18.6") per familj. */
function oldest(list: readonly string[], family: string): number {
  const versions = list.filter((t) => familyOf(t) === family).map((t) => Number.parseFloat(t.split(" ")[1] ?? "NaN"));
  return Math.min(...versions);
}

describe("webbläsarstöd (#1299)", () => {
  it("package.json har en egen konfiguration (inte Next.js standard)", () => {
    expect(browserslist.loadConfig({ path: process.cwd() })).toBeDefined();
  });

  it("byggmålen är exakt policyns webbläsare: Chrome, Edge, Firefox, Safari och iOS", () => {
    expect([...new Set(targets.map(familyOf))].sort()).toEqual(FAMILIES);
    expect([...new Set(browserslist(POLICY).map(familyOf))].sort()).toEqual(FAMILIES);
  });

  it.each(FAMILIES)("%s: byggmålet är inte nyare än policyns äldsta version (koden körs på allt vi stöder)", (family) => {
    expect(oldest(targets, family)).toBeLessThanOrEqual(oldest(browserslist(POLICY), family));
  });

  it("ett mål per webbläsare — en lägsta version, inga intervall med okända nya versioner", () => {
    for (const family of FAMILIES) expect(targets.filter((t) => familyOf(t) === family), family).toHaveLength(1);
  });

  it("inga andra webbläsare: varken Android, Opera, Samsung eller Internet Explorer", () => {
    const families = new Set(targets.map(familyOf));
    for (const other of ["and_chr", "and_ff", "android", "opera", "samsung", "ie", "op_mini"]) {
      expect(families.has(other), other).toBe(false);
    }
  });
});
