/**
 * `pageSlice` (#1011) — frivillig sidning: utelämnad pageSize ÄR dagens
 * beteende (hela listan), allt annat är opt-in. Det är kontraktet som gör att
 * routrarna kunde få sidning utan att någon UI-anropare påverkas.
 */

import { describe, it, expect } from "vitest-compat";
import { pageSlice } from "@/lib/shared/paginate";

const ROWS = ["a", "b", "c", "d", "e"];

describe("pageSlice", () => {
  it("utan pageSize returneras hela listan (dagens beteende)", () => {
    expect(pageSlice(ROWS, undefined)).toEqual(ROWS);
    expect(pageSlice(ROWS, {})).toEqual(ROWS);
    expect(pageSlice(ROWS, { page: 3 })).toEqual(ROWS); // page utan pageSize = meningslös → orörd
  });

  it("returnerar en kopia, aldrig samma referens", () => {
    // Routern får inte läcka ut repo:ts interna array till mutation.
    expect(pageSlice(ROWS, undefined)).not.toBe(ROWS);
  });

  it("skär ut begärd sida, page defaultar till 1", () => {
    expect(pageSlice(ROWS, { pageSize: 2 })).toEqual(["a", "b"]);
    expect(pageSlice(ROWS, { pageSize: 2, page: 2 })).toEqual(["c", "d"]);
    expect(pageSlice(ROWS, { pageSize: 2, page: 3 })).toEqual(["e"]);
  });

  it("sida bortom slutet → tom lista, inget fel", () => {
    expect(pageSlice(ROWS, { pageSize: 2, page: 4 })).toEqual([]);
  });
});
