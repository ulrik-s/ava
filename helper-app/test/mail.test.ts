import { describe, expect, test } from "bun:test";

import { applescriptQuote, escapePs, escapeUrl } from "../src/platform/mail.ts";

describe("applescriptQuote", () => {
  test("escapar backslash + citationstecken", () => {
    expect(applescriptQuote('a "b" c')).toBe('"a \\"b\\" c"');
    expect(applescriptQuote("a\\b")).toBe('"a\\\\b"');
  });
  test("svenska tecken passerar orörda", () => {
    expect(applescriptQuote("Förordnande åäö")).toBe('"Förordnande åäö"');
  });
});

describe("escapePs", () => {
  test("dubblerar single-quotes", () => {
    expect(escapePs("it's a test")).toBe("it''s a test");
  });
});

describe("escapeUrl", () => {
  test("escapar mellanslag + radbryt", () => {
    expect(escapeUrl("hej och hå")).toBe("hej%20och%20hå");
    expect(escapeUrl("rad1\nrad2")).toBe("rad1%0Arad2");
  });
});
