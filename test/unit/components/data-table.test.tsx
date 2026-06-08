/**
 * Pure helpers i DataTable (mergePrefs, sortRows, visibleColumns). UI:t
 * (sort-klick, drag-resize, drag-reorder) täcks bäst av Playwright; här
 * vaktar vi datalogiken.
 */

import { describe, it, expect } from "vitest-compat";
import { mergePrefs, sortRows, visibleColumns, type Column } from "@/components/ui/data-table";

type Row = { id: string; name: string; age: number };
const cols: Column<Row>[] = [
  { key: "name", label: "Namn", render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: "age", label: "Ålder", render: (r) => r.age, sortable: true, sortValue: (r) => r.age },
  { key: "id", label: "Id", render: (r) => r.id, hideable: false },
];
const rows: Row[] = [
  { id: "c", name: "Cesar", age: 30 },
  { id: "a", name: "Anna", age: 25 },
  { id: "b", name: "Bo", age: 40 },
];

describe("mergePrefs — user vinner över org", () => {
  it("personal sortBy övertrumfar org sortBy", () => {
    expect(mergePrefs({ sortBy: "name" }, { sortBy: "age" })).toEqual({ sortBy: "name", sortDir: undefined, order: undefined, columns: undefined });
  });
  it("faller tillbaka till org när user saknar fält", () => {
    expect(mergePrefs({}, { sortBy: "age", sortDir: "desc" })).toEqual({ sortBy: "age", sortDir: "desc", order: undefined, columns: undefined });
  });
});

describe("sortRows", () => {
  it("sorterar asc på sortValue", () => {
    expect(sortRows(rows, cols, "name", "asc").map((r) => r.name)).toEqual(["Anna", "Bo", "Cesar"]);
  });
  it("sorterar desc", () => {
    expect(sortRows(rows, cols, "age", "desc").map((r) => r.age)).toEqual([40, 30, 25]);
  });
  it("ignorerar icke-sorterbar kolumn", () => {
    expect(sortRows(rows, cols, "id", "asc").map((r) => r.id)).toEqual(["c", "a", "b"]); // oförändrat
  });
});

describe("visibleColumns", () => {
  it("filtrerar hidden + respekterar order", () => {
    const out = visibleColumns(cols, { columns: [{ key: "id", hidden: true }], order: ["age", "name"] });
    expect(out.map((c) => c.key)).toEqual(["age", "name"]);
  });
  it("appendar okända kolumner sist", () => {
    const out = visibleColumns(cols, { order: ["age"] });
    expect(out.map((c) => c.key)).toEqual(["age", "name", "id"]);
  });
});
