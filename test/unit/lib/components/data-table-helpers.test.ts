/**
 * DataTable pure helpers: filterRows, groupRows, hasOverrides.
 */
import { describe, it, expect } from "vitest";
import { filterRows, groupRows, hasOverrides, type Column } from "@/components/ui/data-table";

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
