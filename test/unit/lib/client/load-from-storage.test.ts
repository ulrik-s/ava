/**
 * Test för zod-validerad localStorage-läsning (#187).
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { z } from "zod";

import { loadFromStorage } from "@/lib/client/load-from-storage";

const KEY = "test.loadFromStorage";
const schema = z.object({ a: z.string(), n: z.number().int().catch(0) });
const FALLBACK = { a: "fallback", n: -1 };

beforeEach(() => localStorage.removeItem(KEY));

describe("loadFromStorage (#187)", () => {
  it("saknad nyckel → fallback", () => {
    expect(loadFromStorage(KEY, schema, FALLBACK)).toEqual(FALLBACK);
  });

  it("giltig lagrad data → schema-validerad retur", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: "x", n: 7 }));
    expect(loadFromStorage(KEY, schema, FALLBACK)).toEqual({ a: "x", n: 7 });
  });

  it("fältvis tolerans via .catch i schemat", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: "x", n: "inte-tal" }));
    expect(loadFromStorage(KEY, schema, FALLBACK)).toEqual({ a: "x", n: 0 });
  });

  it("schema-miss (fel form) → fallback, aldrig ovaliderad data", () => {
    localStorage.setItem(KEY, JSON.stringify({ helt: "fel" }));
    expect(loadFromStorage(KEY, schema, FALLBACK)).toEqual(FALLBACK);
  });

  it("trasig JSON → fallback, kastar inte", () => {
    localStorage.setItem(KEY, "{inte json");
    expect(loadFromStorage(KEY, schema, FALLBACK)).toEqual(FALLBACK);
  });
});
