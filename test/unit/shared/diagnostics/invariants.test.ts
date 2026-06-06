import { describe, it, expect } from "vitest";
import { detectMatterInvariants, type MatterInvariantInput } from "@/lib/shared/diagnostics/invariants";
import { KOSTNADSRAKNING_DOCUMENT_TYPE } from "@/lib/shared/schemas/document";

function input(over: Partial<MatterInvariantInput> = {}): MatterInvariantInput {
  return {
    matterId: "m-1",
    matterNumber: "2026-0001",
    billingRuns: [],
    documents: [],
    ...over,
  };
}

const pendingKr = { id: "br-1", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT" };

describe("detectMatterInvariants — KR_PENDING_NO_DOC", () => {
  it("flaggar pending kostnadsräkning utan KR-dokument", () => {
    const v = detectMatterInvariants(input({ billingRuns: [pendingKr], documents: [] }));
    expect(v).toHaveLength(1);
    expect(v[0]!.code).toBe("KR_PENDING_NO_DOC");
    expect(v[0]!.severity).toBe("error");
    expect(v[0]!.context).toMatchObject({ matterId: "m-1", billingRunId: "br-1", matterNumber: "2026-0001" });
    expect(v[0]!.message).toContain("2026-0001");
  });

  it("flaggar inte när ett KR-dokument finns i ärendet", () => {
    const v = detectMatterInvariants(input({
      billingRuns: [pendingKr],
      documents: [{ documentType: KOSTNADSRAKNING_DOCUMENT_TYPE }],
    }));
    expect(v).toHaveLength(0);
  });

  it("ignorerar dokument av annan typ", () => {
    const v = detectMatterInvariants(input({
      billingRuns: [pendingKr],
      documents: [{ documentType: "Inlaga" }, { documentType: null }],
    }));
    expect(v).toHaveLength(1);
  });

  it("flaggar inte KR-runs i annat status än PENDING_VERDICT", () => {
    const v = detectMatterInvariants(input({
      billingRuns: [{ id: "br-2", type: "KOSTNADSRAKNING", status: "SENT" }],
      documents: [],
    }));
    expect(v).toHaveLength(0);
  });

  it("flaggar inte andra billing-run-typer i PENDING_VERDICT", () => {
    const v = detectMatterInvariants(input({
      billingRuns: [{ id: "br-3", type: "FINAL", status: "PENDING_VERDICT" }],
      documents: [],
    }));
    expect(v).toHaveLength(0);
  });

  it("ger en violation per pending KR-run när dokument saknas", () => {
    const v = detectMatterInvariants(input({
      billingRuns: [pendingKr, { id: "br-9", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT" }],
      documents: [],
    }));
    expect(v.map((x) => x.context.billingRunId).sort()).toEqual(["br-1", "br-9"]);
  });

  it("faller tillbaka på matterId i meddelandet när matterNumber saknas", () => {
    const v = detectMatterInvariants({ matterId: "m-x", billingRuns: [pendingKr], documents: [] });
    expect(v[0]!.message).toContain("m-x");
    expect(v[0]!.context.matterNumber).toBeUndefined();
  });

  it("returnerar tomt för ett ärende utan billing-runs", () => {
    expect(detectMatterInvariants(input())).toEqual([]);
  });
});
