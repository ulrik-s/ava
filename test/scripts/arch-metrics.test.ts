/**
 * Arkitekturmätningen: samma kod ger samma siffror (deterministiskt), så
 * veckans genomgång kan jämföra trenden.
 */
import { describe, expect, it } from "vitest-compat";
import {
  areaOf, computeMetrics, delta, formatMarkdown, isProductionSource, parseNumstat, type ArchMetrics,
} from "../../tooling/scripts/arch-metrics";

const EXTRA = { duplicationPercent: 0.15, dependencies: 120, generatedAt: "2026-11-11T06:00:00Z" };

describe("areaOf / isProductionSource", () => {
  it.each([
    ["src/lib/server/routers/feedback.ts", "src/lib/server"],
    ["src/lib/shared/feedback.ts", "src/lib/shared"],
    ["src/app/matters/page.tsx", "src/app"],
    ["src/components/shell/sidebar.tsx", "src/components"],
  ])("%s → %s", (path, area) => {
    expect(areaOf(path)).toBe(area);
  });

  it("bara .ts/.tsx under src, inga tester", () => {
    expect(isProductionSource("src/app/page.tsx")).toBe(true);
    expect(isProductionSource("src/lib/x.test.ts")).toBe(false);
    expect(isProductionSource("src/app/x.spec.tsx")).toBe(false);
    expect(isProductionSource("test/unit/x.ts")).toBe(false);
    expect(isProductionSource("src/app/style.css")).toBe(false);
  });
});

describe("parseNumstat", () => {
  it("summerar tillagda + borttagna per fil över flera commits; binärer räknas inte", () => {
    const text = ["10\t2\tsrc/a.ts", "", "3\t0\tsrc/a.ts", "-\t-\tsrc/logo.png", "1\t1\tsrc/b.ts"].join("\n");
    expect([...parseNumstat(text)]).toEqual([["src/a.ts", 15], ["src/b.ts", 2]]);
  });
});

describe("computeMetrics", () => {
  const sizes = new Map([["src/lib/server/a.ts", 400], ["src/lib/server/b.ts", 50], ["src/app/p.tsx", 300], ["src/app/q.tsx", 10]]);
  const churn = new Map([["src/lib/server/b.ts", 100], ["src/app/p.tsx", 20], ["src/gone.ts", 999]]);
  const m = computeMetrics(sizes, churn, EXTRA);

  it("summor, områden och största filer", () => {
    expect(m.totalLines).toBe(760);
    expect(m.files).toBe(4);
    expect(m.linesByArea).toEqual({ "src/lib/server": 450, "src/app": 310 });
    expect(m.largest.map((f) => f.path)).toEqual(["src/lib/server/a.ts", "src/app/p.tsx", "src/lib/server/b.ts", "src/app/q.tsx"]);
  });

  it("hotspots = churn × storlek, bara filer som finns och ändrats", () => {
    expect(m.hotspots).toEqual([
      { path: "src/app/p.tsx", lines: 300, churn: 20, score: 6000 },
      { path: "src/lib/server/b.ts", lines: 50, churn: 100, score: 5000 },
    ]);
  });

  it("samma indata ger samma utdata", () => {
    expect(computeMetrics(sizes, churn, EXTRA)).toEqual(m);
  });
});

describe("delta / formatMarkdown", () => {
  it("delta", () => {
    expect(delta(10, undefined)).toBe("");
    expect(delta(10, 10)).toBe(" (±0)");
    expect(delta(12, 10)).toBe(" (+2)");
    expect(delta(8, 10)).toBe(" (−2)");
  });

  const base: ArchMetrics = computeMetrics(new Map([["src/app/p.tsx", 100]]), new Map(), EXTRA);

  it("utan jämförelse: tabeller utan förändring, och ingen churn", () => {
    const md = formatMarkdown(base);
    expect(md).toContain("| Rader produktionskod | 100 |");
    expect(md).toContain("| Duplicering | 0.15 % |");
    expect(md).toContain("| (ingen churn) | | |");
  });

  it("med förra veckan: förändringen syns; okänd duplicering förklaras", () => {
    const now = { ...base, totalLines: 130, linesByArea: { "src/app": 130 }, duplicationPercent: null };
    const md = formatMarkdown(now, base);
    expect(md).toContain("| Rader produktionskod | 130 (+30) |");
    expect(md).toContain("| `src/app` | 130 (+30) |");
    expect(md).toContain("okänd (kör `bun run duplicates`)");
  });
});
