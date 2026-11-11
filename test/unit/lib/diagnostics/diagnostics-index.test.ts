import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { issueStore, reportSelfDetected } from "@/lib/client/diagnostics";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

const v: InvariantViolation = {
  code: "KR_PENDING_NO_DOC",
  severity: "error",
  message: "fel",
  context: { matterId: "m-1" },
};

beforeEach(() => issueStore.clear());

describe("reportSelfDetected", () => {
  it("lägger nya fel i store:n och loggar dem en gång", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportSelfDetected([v]);
    expect(issueStore.count()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);

    reportSelfDetected([v]); // dedup → ingen ny logg
    expect(issueStore.count()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("är no-op för tom lista", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportSelfDetected([]);
    expect(issueStore.count()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
