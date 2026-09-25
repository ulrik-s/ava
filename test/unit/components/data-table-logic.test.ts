/**
 * Test för data-table-logic (#62/#27) — ramverks-agnostisk DataTable-kärna:
 * sort/filter/group/prefs. Rena funktioner → testas isolerat (ingen React).
 */

import { describe, it, expect } from "vitest-compat";
import {
  withColumnWidth,
  withColumnWidths,
  fixedTableWidth,
  menuPosition,
  withColumnHidden,
  type Column,
  type DataTablePrefs,
  isFilterable,
  isGroupable,
  mergePrefs,
  sortRows,
  filterRows,
  groupRows,
  isColumnHidden,
  visibleColumns,
  hasOverrides,
  hasSummary,
  buildSummaryContent,
  hideBelowClass,
} from "@/components/ui/data-table-logic";

interface Row { name: string; n: number; when: Date | null; type: string }

const cols: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: "n", label: "N", render: (r) => String(r.n), sortable: true, sortValue: (r) => r.n },
  { key: "when", label: "När", render: () => "", sortable: true, sortValue: (r) => r.when },
  { key: "type", label: "Typ", render: (r) => r.type, sortable: true, groupValue: (r) => r.type },
  { key: "plain", label: "Plain", render: (r) => r.name }, // ej sortable
];

const rows: Row[] = [
  { name: "Cecilia", n: 3, when: new Date("2026-03-01"), type: "A" },
  { name: "anna", n: 1, when: null, type: "B" },
  { name: "Björn", n: 2, when: new Date("2026-01-01"), type: "A" },
];

describe("isFilterable / isGroupable", () => {
  it("ärver från sortable, kan stängas av explicit", () => {
    expect(isFilterable({ key: "x", label: "", render: () => "", sortable: true })).toBe(true);
    expect(isGroupable({ key: "x", label: "", render: () => "", sortable: true })).toBe(true);
    expect(isFilterable({ key: "x", label: "", render: () => "", sortable: true, filterable: false })).toBe(false);
    expect(isGroupable({ key: "x", label: "", render: () => "", sortable: false })).toBe(false);
  });
});

describe("mergePrefs", () => {
  it("user vinner över org, fallback till org, undefined hoppas", () => {
    const user: DataTablePrefs = { sortBy: "name", filters: undefined };
    const org: DataTablePrefs = { sortBy: "n", groupBy: "type" };
    expect(mergePrefs(user, org)).toEqual({ sortBy: "name", groupBy: "type" });
    expect(mergePrefs(null, null)).toEqual({});
  });
});

describe("sortRows", () => {
  it("utan sortBy/sortDir → oförändrat", () => {
    expect(sortRows(rows, cols)).toBe(rows);
  });
  it("icke-sorterbar kolumn → oförändrat", () => {
    expect(sortRows(rows, cols, "plain", "asc")).toBe(rows);
  });
  it("numeriskt asc + desc", () => {
    expect(sortRows(rows, cols, "n", "asc").map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortRows(rows, cols, "n", "desc").map((r) => r.n)).toEqual([3, 2, 1]);
  });
  it("sträng case-insensitive (sv) asc", () => {
    expect(sortRows(rows, cols, "name", "asc").map((r) => r.name)).toEqual(["anna", "Björn", "Cecilia"]);
  });
  it("Date-sortering + null hamnar sist vid asc, först vid desc", () => {
    expect(sortRows(rows, cols, "when", "asc").map((r) => r.name)).toEqual(["Björn", "Cecilia", "anna"]);
    expect(sortRows(rows, cols, "when", "desc")[0]!.name).toBe("anna"); // null först
  });
});

describe("filterRows", () => {
  it("utan filter → oförändrat; tom/whitespace räknas ej", () => {
    expect(filterRows(rows, cols, {})).toBe(rows);
    expect(filterRows(rows, cols, { name: "  " })).toBe(rows);
  });
  it("substring case-insensitive på filterValue/sortValue/render", () => {
    expect(filterRows(rows, cols, { name: "JÖR" }).map((r) => r.name)).toEqual(["Björn"]);
  });
  it("flera filter → AND; okänd kolumn-key ignoreras", () => {
    expect(filterRows(rows, cols, { type: "A", n: "2" }).map((r) => r.name)).toEqual(["Björn"]);
    expect(filterRows(rows, cols, { saknas: "x" })).toEqual(rows);
  });
});

describe("groupRows", () => {
  it("utan groupBy → en grupp (null)", () => {
    expect(groupRows(rows, cols)).toEqual([{ group: null, rows }]);
  });
  it("okänd kolumn → en grupp (null)", () => {
    expect(groupRows(rows, cols, "saknas")).toEqual([{ group: null, rows }]);
  });
  it("grupperar på groupValue", () => {
    const g = groupRows(rows, cols, "type");
    expect(g.map((x) => x.group)).toEqual(["A", "B"]);
    expect(g[0]!.rows).toHaveLength(2);
  });
  it("tomt gruppvärde → (tomt)", () => {
    const emptyCol: Column<Row>[] = [{ key: "e", label: "", render: () => "", sortable: true, groupValue: () => "" }];
    expect(groupRows(rows, emptyCol, "e")[0]!.group).toBe("(tomt)");
  });
});

describe("kolumn-synlighet", () => {
  it("isColumnHidden: explicit override vinner över defaultHidden", () => {
    const col: Column<Row> = { key: "name", label: "", render: () => "", defaultHidden: true };
    expect(isColumnHidden(col, {})).toBe(true); // defaultHidden
    expect(isColumnHidden(col, { columns: [{ key: "name", hidden: false }] })).toBe(false); // override visar
  });
  it("visibleColumns: filtrerar dolda + sorterar enligt order (saknade appendas)", () => {
    const prefs: DataTablePrefs = { columns: [{ key: "n", hidden: true }], order: ["type", "name"] };
    const vis = visibleColumns(cols, prefs).map((c) => c.key);
    expect(vis).not.toContain("n");
    expect(vis.slice(0, 2)).toEqual(["type", "name"]); // order-styrt
  });
});

describe("menuPosition (#1152 — rubrikmenyn i fönstrets koordinater)", () => {
  const vp = { width: 1000, height: 800 };
  it("under rubriken, vänsterjusterad", () => {
    expect(menuPosition({ bottom: 100, left: 200, right: 300 }, "left", vp)).toEqual({ top: 104, left: 200, maxHeight: 688 });
  });
  it("högerjusterad kolumn → menyn fästs i rubrikens högerkant", () => {
    expect(menuPosition({ bottom: 100, left: 800, right: 900 }, "right", vp)).toEqual({ top: 104, right: 100, maxHeight: 688 });
  });
  it("nära fönsterkanterna → hålls inom marginalen, minst 120 px hög (scrollar själv)", () => {
    expect(menuPosition({ bottom: 780, left: -20, right: 50 }, "left", vp)).toEqual({ top: 784, left: 8, maxHeight: 120 });
  });
});

describe("withColumnWidth / withColumnWidths (#1170)", () => {
  it("sätter bredd och BEHÅLLER dold-flaggan (förr skrevs posten om till bara { key, width })", () => {
    expect(withColumnWidth({ columns: [{ key: "age", hidden: true }] }, "age", 200)).toEqual([{ key: "age", hidden: true, width: 200 }]);
  });
  it("flera bredder på en gång: uppdaterar befintliga och lägger till nya", () => {
    expect(withColumnWidths({ columns: [{ key: "a", width: 10 }, { key: "b", hidden: true }] }, { a: 50, c: 70 }))
      .toEqual([{ key: "a", width: 50 }, { key: "b", hidden: true }, { key: "c", width: 70 }]);
  });
});

describe("fixedTableWidth (#1170)", () => {
  const colA = { key: "a", label: "A", render: () => null };
  const colB = { key: "b", label: "B", render: () => null, defaultWidth: 100 };
  it("alla kolumner har bredd (sparad eller default) → summan + avslutande kolumn", () => {
    expect(fixedTableWidth([colA, colB], { columns: [{ key: "a", width: 150 }] })).toBe(150 + 100 + 32);
  });
  it("någon kolumn saknar bredd → null (automatisk layout)", () => {
    expect(fixedTableWidth([colA, colB], {})).toBeNull();
  });
  it("inga kolumner → null", () => {
    expect(fixedTableWidth([], {})).toBeNull();
  });
});

describe("withColumnHidden", () => {
  it("lägger till override för ny kolumn", () => {
    expect(withColumnHidden({}, "age", true)).toEqual([{ key: "age", hidden: true }]);
  });
  it("uppdaterar befintlig override och behåller bredden", () => {
    expect(withColumnHidden({ columns: [{ key: "age", width: 120, hidden: true }, { key: "name" }] }, "age", false))
      .toEqual([{ key: "age", width: 120, hidden: false }, { key: "name" }]);
  });
});

describe("hasOverrides", () => {
  it("true vid sort/group/filter/kolumn-override/order; annars false", () => {
    expect(hasOverrides({})).toBe(false);
    expect(hasOverrides({ sortBy: "name" })).toBe(true);
    expect(hasOverrides({ groupBy: "type" })).toBe(true);
    expect(hasOverrides({ filters: { name: "x" } })).toBe(true);
    expect(hasOverrides({ columns: [{ key: "n", hidden: true }] })).toBe(true);
    expect(hasOverrides({ columns: [{ key: "n", width: 120 }] })).toBe(true);
    expect(hasOverrides({ order: ["a"] })).toBe(true);
    expect(hasOverrides({ filters: { name: " " } })).toBe(false);
  });
});

describe("summary", () => {
  it("hasSummary + buildSummaryContent kör summary-funktionerna", () => {
    const sumCols: Column<Row>[] = [
      { key: "n", label: "", render: () => "", summary: (rs) => rs.reduce((s, r) => s + r.n, 0) },
      { key: "name", label: "", render: () => "" },
    ];
    expect(hasSummary(sumCols)).toBe(true);
    expect(hasSummary(cols)).toBe(false);
    expect(buildSummaryContent(sumCols, rows)).toEqual({ n: 6 });
  });
});

/**
 * `hideBelow` (#983) — responsiv kolumndöljning. Klasserna måste vara STATISKA
 * strängar: Tailwind genererar bara det den ser i källkoden, så en interpolerad
 * `` `hidden ${bp}:table-cell` `` hade gett en klass som saknas i bundlen — och
 * en kolumn som försvinner på mobil utan att komma tillbaka på desktop.
 */
describe("hideBelowClass", () => {
  const col = (hideBelow?: Column<Row>["hideBelow"]): Column<Row> =>
    ({ key: "k", label: "K", render: () => "", ...(hideBelow ? { hideBelow } : {}) });

  it("utelämnad → tom sträng (kolumnen syns på alla skärmar)", () => {
    expect(hideBelowClass(col())).toBe("");
  });

  it("varje brytpunkt ger sin döljning OCH sin återställning", () => {
    // Båda halvorna behövs: utan `<bp>:table-cell` blir kolumnen borta överallt.
    expect(hideBelowClass(col("sm"))).toBe("hidden sm:table-cell");
    expect(hideBelowClass(col("md"))).toBe("hidden md:table-cell");
    expect(hideBelowClass(col("lg"))).toBe("hidden lg:table-cell");
  });
});
