/**
 * `_radgivning-entry` (#1207) — fakturapanelens varning och tidslistans
 * "Markera som rådgivning"-hook. Båda läser `timeEntry.radgivningStatus`.
 * Den nya bindningen (#1929): en riktig QueryClient över en fejkad länk.
 */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { RadgivningEntryWarning, useMarkRadgivning } from "@/app/matters/[id]/_radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../../helpers/trpc-fake";

const matterId = asId<"MatterId">("m-1");
const MISSING = { kind: "missing", invoiceId: "inv-r" };

function setup(status: unknown, extra: TrpcHandlers = {}) {
  const fake = fakeTrpcLink({ "timeEntry.radgivningStatus": () => status, ...extra });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>{children}</TrpcTestProvider>
  );
  return { fake, invalidate, wrapper };
}

const statusCalls = (calls: ReadonlyArray<{ path: string }>) => calls.filter((c) => c.path === "timeEntry.radgivningStatus");

afterEach(() => { vi.restoreAllMocks(); });

describe("RadgivningEntryWarning", () => {
  it("visas när rådgivningsfakturan saknar låst post", async () => {
    const { fake, wrapper } = setup(MISSING);
    render(<RadgivningEntryWarning matterId={matterId} paymentMethod="RATTSHJALP" />, { wrapper });
    expect((await screen.findByRole("status")).textContent).toContain("Rådgivningsfakturan saknar låst rådgivningspost");
    expect(fake.calls).toEqual([{ path: "timeEntry.radgivningStatus", type: "query", input: { matterId } }]);
  });

  it("visas inte när posten finns", async () => {
    const { fake, wrapper } = setup({ kind: "present", invoiceId: "inv-r" });
    const { container } = render(<RadgivningEntryWarning matterId={matterId} paymentMethod="RATTSHJALP" />, { wrapper });
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(container.textContent).toBe("");
  });

  it("frågar inte ens utanför rättshjälp", () => {
    const { fake, wrapper } = setup(MISSING);
    const { container } = render(<RadgivningEntryWarning matterId={matterId} paymentMethod="PRIVAT" />, { wrapper });
    expect(container.textContent).toBe("");
    expect(statusCalls(fake.calls)).toEqual([]);
  });
});

describe("useMarkRadgivning", () => {
  it("canMark följer regeln i ett ärende som saknar posten (#1235)", async () => {
    const { wrapper } = setup(MISSING);
    const run = asId<"BillingRunId">("run-kr");
    const { result } = renderHook(() => useMarkRadgivning(matterId, "RATTSHJALP"), { wrapper });
    await waitFor(() => expect(result.current.canMark({ billable: true })).toBe(true));
    expect(result.current.canMark({ billable: false })).toBe(true);
    expect(result.current.canMark({ billable: false, frozenAt: new Date(), frozenByBillingRunId: run })).toBe(true);
    expect(result.current.canMark({ billable: true, frozenAt: new Date(), frozenByBillingRunId: run })).toBe(false);
    expect(result.current.canMark({ billable: true, frozenAt: new Date() })).toBe(false);
  });

  it("canMark är false när status saknas", () => {
    const { wrapper } = setup(MISSING);
    const { result } = renderHook(() => useMarkRadgivning(matterId, "PRIVAT"), { wrapper });
    expect(result.current.canMark({ billable: true })).toBe(false);
  });

  it("markera frågar först; Avbryt anropar ingenting", () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const { fake, wrapper } = setup(MISSING);
    const { result } = renderHook(() => useMarkRadgivning(matterId, "PRIVAT"), { wrapper });
    act(() => { result.current.mark(asId<"TimeEntryId">("te-1")); });
    expect(fake.calls).toEqual([]);
  });

  it("lyckad markering invaliderar tid + fakturering", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const { fake, invalidate, wrapper } = setup(MISSING, { "timeEntry.markAsRadgivning": () => ({ ok: true }) });
    const { result } = renderHook(() => useMarkRadgivning(matterId, "PRIVAT"), { wrapper });
    act(() => { result.current.mark(asId<"TimeEntryId">("te-1")); });
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(["billingRun", "timeEntry"]));
    expect(fake.calls).toEqual([{ path: "timeEntry.markAsRadgivning", type: "mutation", input: { id: "te-1" } }]);
  });

  it("misslyckad markering visas — aldrig tyst", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(globalThis, "alert").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { invalidate, wrapper } = setup(MISSING, {
      "timeEntry.markAsRadgivning": () => { throw new Error("Ärendet har redan en låst rådgivningspost."); },
    });
    const { result } = renderHook(() => useMarkRadgivning(matterId, "PRIVAT"), { wrapper });
    act(() => { result.current.mark(asId<"TimeEntryId">("te-1")); });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Kunde inte markera: Ärendet har redan en låst rådgivningspost."));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
