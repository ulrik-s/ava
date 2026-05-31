/**
 * DataTable pure helpers: filterRows, groupRows, hasOverrides.
 */
import { describe, it, expect } from "vitest";
import { filterRows, groupRows, hasOverrides, isFilterable, isGroupable, isColumnHidden, hasSummary, buildSummaryContent, type Column } from "@/components/ui/data-table";

interface Row { id: string; name: string; status: string; amount: number }

const cols: Column<Row>[] = [
  { key: "name", label: "Namn", filterable: true, groupable: true,
    filterValue: (r) => r.name, groupValue: (r) => r.name, render: (r) => r.name },
  { key: "status", label: "Status", filterable: true, groupable: true,
    filterValue: (r) => r.status, groupValue: (r) => r.status, render: (r) => r.status },
  { key: "amount", label: "Belopp",
    filterValue: (r) => String(r.amount), render: (r) => String(r.amount) },
];

const rows: Row[] = [
  { id: "1", name: "Anna", status: "Aktiv", amount: 100 },
  { id: "2", name: "Björn", status: "Klar", amount: 200 },
  { id: "3", name: "Anna B", status: "Aktiv", amount: 300 },
];

describe("filterRows", () => {
  it("returnerar alla rader när filter saknas", () => {
    expect(filterRows(rows, cols)).toEqual(rows);
    expect(filterRows(rows, cols, {})).toEqual(rows);
  });

  it("matchar case-insensitive substring per kolumn", () => {
    expect(filterRows(rows, cols, { name: "anna" })).toHaveLength(2);
    expect(filterRows(rows, cols, { name: "BJÖR" })).toHaveLength(1);
  });

  it("kombinerar filter (AND mellan kolumner)", () => {
    const r = filterRows(rows, cols, { name: "anna", status: "Aktiv" });
    expect(r).toHaveLength(2);
  });

  it("ignorerar tomma filter-värden", () => {
    expect(filterRows(rows, cols, { name: "", status: "Klar" })).toHaveLength(1);
  });

  it("ignorerar filter på okänd kolumn", () => {
    expect(filterRows(rows, cols, { okand: "x" })).toEqual(rows);
  });
});

describe("groupRows", () => {
  it("returnerar 1 grupp utan label när groupBy saknas", () => {
    const g = groupRows(rows, cols);
    expect(g).toHaveLength(1);
    expect(g[0].group).toBeNull();
    expect(g[0].rows).toHaveLength(3);
  });

  it("grupperar rader på vald kolumn", () => {
    const g = groupRows(rows, cols, "status");
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.group === "Aktiv")?.rows).toHaveLength(2);
    expect(g.find((x) => x.group === "Klar")?.rows).toHaveLength(1);
  });

  it("ignorerar okänd groupBy-key", () => {
    const g = groupRows(rows, cols, "okand");
    expect(g[0].group).toBeNull();
    expect(g[0].rows).toHaveLength(3);
  });

  it("tomt groupValue → label '(tomt)'", () => {
    const blank = [{ id: "x", name: "", status: "Aktiv", amount: 0 }];
    const g = groupRows(blank, cols, "name");
    expect(g[0].group).toBe("(tomt)");
  });
});

describe("isColumnHidden / defaultHidden — katalog-fält", () => {
  it("defaultHidden=true → kolumnen är dold tills user explicit visar den", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, defaultHidden: true };
    expect(isColumnHidden(col, {})).toBe(true);
  });

  it("defaultHidden=false (default) → kolumnen är synlig som default", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x };
    expect(isColumnHidden(col, {})).toBe(false);
  });

  it("user-pref { hidden: false } override:ar defaultHidden", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, defaultHidden: true };
    expect(isColumnHidden(col, { columns: [{ key: "x", hidden: false }] })).toBe(false);
  });

  it("user-pref { hidden: true } gömmer även icke-defaultHidden", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x };
    expect(isColumnHidden(col, { columns: [{ key: "x", hidden: true }] })).toBe(true);
  });
});

describe("isFilterable / isGroupable — sortable opt-in:ar båda", () => {
  it("sortable=true → filterable + groupable ärvs automatiskt", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, sortable: true };
    expect(isFilterable(col)).toBe(true);
    expect(isGroupable(col)).toBe(true);
  });

  it("sortable=false → filterable + groupable är false som default", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x };
    expect(isFilterable(col)).toBe(false);
    expect(isGroupable(col)).toBe(false);
  });

  it("explicit filterable: false slår av även när sortable=true", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, sortable: true, filterable: false };
    expect(isFilterable(col)).toBe(false);
    expect(isGroupable(col)).toBe(true);
  });

  it("explicit groupable: false slår av group men inte filter", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, sortable: true, groupable: false };
    expect(isFilterable(col)).toBe(true);
    expect(isGroupable(col)).toBe(false);
  });

  it("explicit filterable: true override:ar sortable=false (för specialfall)", () => {
    const col: Column<{ x: string }> = { key: "x", label: "X", render: (r) => r.x, filterable: true };
    expect(isFilterable(col)).toBe(true);
  });
});

describe("hasSummary / buildSummaryContent — auto-summa", () => {
  const sumCols: Column<{ id: string; amount: number; name: string }>[] = [
    { key: "name", label: "Namn", render: (r) => r.name },
    { key: "amount", label: "Belopp", render: (r) => String(r.amount),
      summary: (rows) => String(rows.reduce((s, r) => s + r.amount, 0)) },
  ];

  it("hasSummary=true om någon kolumn har summary-funktion", () => {
    expect(hasSummary(sumCols)).toBe(true);
  });

  it("hasSummary=false om INGEN kolumn har summary", () => {
    const cols: Column<{ x: string }>[] = [{ key: "x", label: "X", render: (r) => r.x }];
    expect(hasSummary(cols)).toBe(false);
  });

  it("buildSummaryContent kallar summary med raderna och returnerar map per kolumn-key", () => {
    const out = buildSummaryContent(sumCols, [
      { id: "1", amount: 100, name: "A" },
      { id: "2", amount: 250, name: "B" },
    ]);
    expect(out.amount).toBe("350");
    expect(out.name).toBeUndefined(); // ingen summary → ingen key
  });

  it("buildSummaryContent på tom rad-array → returnerar summary av tom array", () => {
    const out = buildSummaryContent(sumCols, []);
    expect(out.amount).toBe("0");
  });
});

describe("hasOverrides", () => {
  it("false för tom prefs", () => {
    expect(hasOverrides({})).toBe(false);
  });

  it("true när sortBy är satt", () => {
    expect(hasOverrides({ sortBy: "name", sortDir: "asc" })).toBe(true);
  });

  it("true när groupBy är satt", () => {
    expect(hasOverrides({ groupBy: "status" })).toBe(true);
  });

  it("true när någon kolumn är dold", () => {
    expect(hasOverrides({ columns: [{ key: "x", hidden: true }] })).toBe(true);
  });

  it("true när någon kolumn har width-override", () => {
    expect(hasOverrides({ columns: [{ key: "x", width: 200 }] })).toBe(true);
  });

  it("true när ett filter har innehåll", () => {
    expect(hasOverrides({ filters: { name: "anna" } })).toBe(true);
  });

  it("false när alla filter är tomma strängar", () => {
    expect(hasOverrides({ filters: { name: "", status: "  " } })).toBe(false);
  });
});
