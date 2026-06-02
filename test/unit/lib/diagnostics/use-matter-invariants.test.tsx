import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mockbara query-resultat — styrs per test via dessa variabler.
let runsResult: { data?: { runs: unknown[] } } = {};
let docsResult: { data?: { documents: unknown[] } } = {};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    billingRun: { list: { useQuery: () => runsResult } },
    document: { list: { useQuery: () => docsResult } },
  },
}));

import { useMatterInvariants } from "@/lib/client/diagnostics/use-matter-invariants";
import { issueStore } from "@/lib/client/diagnostics";

const pendingKr = { id: "br-1", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT" };

beforeEach(() => {
  issueStore.clear();
  runsResult = {};
  docsResult = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("useMatterInvariants", () => {
  it("rapporterar inget innan datat laddats", () => {
    renderHook(() => useMatterInvariants({ matterId: "m-1", matterNumber: "2026-1" }));
    expect(issueStore.count()).toBe(0);
  });

  it("rapporterar KR_PENDING_NO_DOC när KR-dokument saknas", () => {
    runsResult = { data: { runs: [pendingKr] } };
    docsResult = { data: { documents: [] } };
    renderHook(() => useMatterInvariants({ matterId: "m-1", matterNumber: "2026-1" }));
    expect(issueStore.count()).toBe(1);
    expect(issueStore.list()[0].code).toBe("KR_PENDING_NO_DOC");
  });

  it("rapporterar inget när KR-dokument finns", () => {
    runsResult = { data: { runs: [pendingKr] } };
    docsResult = { data: { documents: [{ documentType: "Kostnadsräkning" }] } };
    renderHook(() => useMatterInvariants({ matterId: "m-1" }));
    expect(issueStore.count()).toBe(0);
  });
});
