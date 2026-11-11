/**
 * `primitiveText` (#1469) — text för okända värden utan "[object Object]".
 */

import { describe, expect, it } from "vitest-compat";
import { primitiveText } from "@/lib/shared/primitive-text";

describe("primitiveText", () => {
  it("ger primitiva värden som text", () => {
    expect(primitiveText("abc")).toBe("abc");
    expect(primitiveText(42)).toBe("42");
    expect(primitiveText(10n)).toBe("10");
    expect(primitiveText(true)).toBe("true");
    expect(primitiveText(false)).toBe("false");
  });

  it("ger tom sträng för allt som annars blivit [object Object] eller skräp", () => {
    expect(primitiveText(null)).toBe("");
    expect(primitiveText(undefined)).toBe("");
    expect(primitiveText({ a: 1 })).toBe("");
    expect(primitiveText([1, 2])).toBe("");
    expect(primitiveText(new Date(0))).toBe("");
    expect(primitiveText(() => 1)).toBe("");
    expect(primitiveText(Symbol("s"))).toBe("");
  });
});
