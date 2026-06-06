import { describe, it, expect, vi } from "vitest";
import { IssueStore } from "@/lib/client/diagnostics/issue-store";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

function v(over: Partial<InvariantViolation> = {}): InvariantViolation {
  return {
    code: "KR_PENDING_NO_DOC",
    severity: "error",
    message: "fel",
    context: { matterId: "m-1", billingRunId: "br-1" },
    ...over,
  };
}

describe("IssueStore", () => {
  it("lägger till och listar överträdelser", () => {
    const s = new IssueStore();
    expect(s.report([v()])).toBe(1);
    expect(s.count()).toBe(1);
    expect(s.list()[0]!.code).toBe("KR_PENDING_NO_DOC");
  });

  it("dedupar på code + context", () => {
    const s = new IssueStore();
    s.report([v()]);
    expect(s.report([v()])).toBe(0); // samma → ingen ny
    expect(s.count()).toBe(1);
  });

  it("skiljer på olika context", () => {
    const s = new IssueStore();
    s.report([v({ context: { matterId: "m-1", billingRunId: "br-1" } })]);
    s.report([v({ context: { matterId: "m-2", billingRunId: "br-2" } })]);
    expect(s.count()).toBe(2);
  });

  it("context-nyckelordning påverkar inte dedup", () => {
    const s = new IssueStore();
    s.report([v({ context: { matterId: "m-1", billingRunId: "br-1" } })]);
    const added = s.report([v({ context: { billingRunId: "br-1", matterId: "m-1" } })]);
    expect(added).toBe(0);
  });

  it("notifierar prenumeranter vid nya fel och vid clear", () => {
    const s = new IssueStore();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    s.report([v()]);
    expect(listener).toHaveBeenCalledTimes(1);
    s.report([v()]); // dedup → ingen notify
    expect(listener).toHaveBeenCalledTimes(1);
    s.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    s.report([v({ context: { matterId: "m-9" } })]);
    expect(listener).toHaveBeenCalledTimes(2); // avregistrerad
  });

  it("clear på tom store notifierar inte", () => {
    const s = new IssueStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.clear();
    expect(listener).not.toHaveBeenCalled();
  });
});
