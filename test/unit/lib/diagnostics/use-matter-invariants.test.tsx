import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";

import { issueStore } from "@/lib/client/diagnostics";
import { useMatterInvariants } from "@/lib/client/diagnostics/use-matter-invariants";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcWrapper, never, type FakeTrpcLink } from "../../../helpers/trpc-fake";

// Mockbara query-resultat — styrs per test via dessa variabler.
let runsResult: { data?: { runs: unknown[] } } = {};
let docsResult: { data?: { documents: unknown[] } } = {};

/**
 * Kör hooken under en fejkad tRPC-länk och väntar tills båda frågorna svarat.
 * Alla mappar (#1308): invarianten läser document.tree, inte en enskild mapp.
 */
async function runInvariants(args: Parameters<typeof useMatterInvariants>[0]): Promise<FakeTrpcLink> {
  const { wrapper, fake, queryClient } = fakeTrpcWrapper({
    "billingRun.list": () => runsResult.data ?? never(),
    "document.tree": () => docsResult.data ?? never(),
  });
  renderHook(() => useMatterInvariants(args), { wrapper });
  await waitFor(() => expect(fake.calls.map((c) => c.path).sort()).toEqual(["billingRun.list", "document.tree"]));
  // Frågor utan data svarar aldrig; resten ska ha landat.
  const unanswered = [runsResult.data, docsResult.data].filter((d) => d === undefined).length;
  await waitFor(() => expect(queryClient.isFetching()).toBe(unanswered));
  await new Promise((r) => setTimeout(r, 0));
  return fake;
}

const pendingKr = { id: "br-1", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT" };

beforeEach(() => {
  issueStore.clear();
  runsResult = {};
  docsResult = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("useMatterInvariants", () => {
  it("rapporterar inget innan datat laddats", async () => {
    await runInvariants({ matterId: asId<"MatterId">("m-1"), matterNumber: "2026-1" });
    expect(issueStore.count()).toBe(0);
  });

  it("rapporterar KR_PENDING_NO_DOC när KR-dokument saknas", async () => {
    runsResult = { data: { runs: [pendingKr] } };
    docsResult = { data: { documents: [] } };
    await runInvariants({ matterId: asId<"MatterId">("m-1"), matterNumber: "2026-1" });
    expect(issueStore.count()).toBe(1);
    expect(issueStore.list()[0]!.code).toBe("KR_PENDING_NO_DOC");
  });

  it("KR-dokument i en undermapp räknas — inget falsklarm (#1308)", async () => {
    runsResult = { data: { runs: [pendingKr] } };
    docsResult = { data: { documents: [{ documentType: "Kostnadsräkning", folderId: "f-kostnadsrakningar" }] } };
    await runInvariants({ matterId: asId<"MatterId">("m-1"), matterNumber: "2026-1" });
    expect(issueStore.count()).toBe(0);
  });

  it("rapporterar inget när KR-dokument finns", async () => {
    runsResult = { data: { runs: [pendingKr] } };
    docsResult = { data: { documents: [{ documentType: "Kostnadsräkning" }] } };
    await runInvariants({ matterId: asId<"MatterId">("m-1") });
    expect(issueStore.count()).toBe(0);
  });
});
