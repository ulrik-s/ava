import { describe, it, expect } from "vitest";
import { omitUndefined } from "@/lib/shared/omit-undefined";

describe("omitUndefined (#32)", () => {
  it("tar bort nycklar med värdet undefined", () => {
    expect(omitUndefined({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("behåller null, 0, '' och false (bara undefined strippas)", () => {
    expect(omitUndefined({ a: null, b: 0, c: "", d: false, e: undefined })).toEqual({
      a: null, b: 0, c: "", d: false,
    });
  });

  it("returnerar tomt objekt när alla värden är undefined", () => {
    expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
  });

  it("är en kopia, muterar inte input", () => {
    const input = { a: 1, b: undefined };
    const out = omitUndefined(input);
    expect(out).not.toBe(input);
    expect(input).toEqual({ a: 1, b: undefined });
  });
});
