import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  issueStore,
  reportSelfDetected,
  issueRepo,
  collectMeta,
} from "@/lib/client/diagnostics";
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

describe("issueRepo", () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_ISSUE_REPO; });

  it("faller tillbaka på ulrik-s/ava utan override", () => {
    expect(issueRepo()).toEqual({ owner: "ulrik-s", repo: "ava" });
  });

  it("respekterar NEXT_PUBLIC_ISSUE_REPO-override", () => {
    process.env.NEXT_PUBLIC_ISSUE_REPO = "acme/support";
    expect(issueRepo()).toEqual({ owner: "acme", repo: "support" });
  });

  it("faller tillbaka vid ogiltig override", () => {
    process.env.NEXT_PUBLIC_ISSUE_REPO = "inte-en-repo-spec!!";
    expect(issueRepo()).toEqual({ owner: "ulrik-s", repo: "ava" });
  });
});

describe("collectMeta", () => {
  it("ger ett objekt (utan window i node-miljö)", () => {
    const meta = collectMeta();
    expect(meta).toBeTypeOf("object");
    expect(meta.url).toBeUndefined(); // ingen window i node
  });
});
