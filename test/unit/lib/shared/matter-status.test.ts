/**
 * Ärendets statusregler (#2004): öppet ärende är allt som inte är känt stängt,
 * också en saknad eller okänd status.
 */

import { describe, expect, it } from "vitest-compat";
import { isOpenMatter } from "@/lib/shared/matter-status";

describe("isOpenMatter", () => {
  it("aktivt ärende är öppet", () => {
    expect(isOpenMatter("ACTIVE")).toBe(true);
  });

  it("stängt och arkiverat ärende är inte öppet", () => {
    expect(isOpenMatter("CLOSED")).toBe(false);
    expect(isOpenMatter("ARCHIVED")).toBe(false);
  });

  it("saknad eller okänd status räknas som öppen", () => {
    expect(isOpenMatter(null)).toBe(true);
    expect(isOpenMatter(undefined)).toBe(true);
    expect(isOpenMatter("PAUSED")).toBe(true);
  });
});
