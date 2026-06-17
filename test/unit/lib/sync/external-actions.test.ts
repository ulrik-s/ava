/**
 * Online-only-handlingar — status-härledning (#417, ADR 0021).
 */

import { describe, it, expect } from "vitest-compat";
import { externalActionStatus, pendingExternalCount } from "@/lib/client/sync/external-actions";

describe("externalActionStatus", () => {
  it("queued → pending", () => {
    expect(externalActionStatus("queued")).toBe("pending");
  });
  it("sent/delivered → done", () => {
    expect(externalActionStatus("sent")).toBe("done");
    expect(externalActionStatus("delivered")).toBe("done");
  });
  it("failed → failed", () => {
    expect(externalActionStatus("failed")).toBe("failed");
  });
  it("okänt/in-flight → pending (defensivt)", () => {
    expect(externalActionStatus("sending")).toBe("pending");
  });
});

describe("pendingExternalCount", () => {
  it("räknar bara handlingar som väntar på att skickas", () => {
    const items = [{ status: "queued" }, { status: "sent" }, { status: "failed" }, { status: "queued" }];
    expect(pendingExternalCount(items)).toBe(2);
  });
  it("tom lista → 0", () => {
    expect(pendingExternalCount([])).toBe(0);
  });
});
