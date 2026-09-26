/**
 * `_radgivning-entry` (#1207) — fakturapanelens varning och tidslistans
 * "Markera som rådgivning"-hook. Båda läser `timeEntry.radgivningStatus`.
 */
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { RadgivningEntryWarning, useMarkRadgivning } from "@/app/matters/[id]/_radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";

const statusQuery: { data: unknown } = { data: undefined };
const statusUseQuery = vi.fn((_input: unknown, _opts: { enabled: boolean }) => statusQuery);
const mutate = vi.fn();
let mutationOpts: { onSuccess: () => void; onError: (e: { message: string }) => void } | undefined;
const invalidateTimeEntry = vi.fn();
const invalidateBillingRun = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ timeEntry: { invalidate: invalidateTimeEntry }, billingRun: { invalidate: invalidateBillingRun } }),
    timeEntry: {
      radgivningStatus: { useQuery: (input: unknown, opts: { enabled: boolean }) => statusUseQuery(input, opts) },
      markAsRadgivning: {
        useMutation: (opts: typeof mutationOpts) => { mutationOpts = opts; return { mutate, isPending: false }; },
      },
    },
  },
}));

const matterId = asId<"MatterId">("m-1");
const MISSING = { kind: "missing", invoiceId: "inv-r" };

beforeEach(() => {
  vi.clearAllMocks();
  statusQuery.data = undefined;
  mutationOpts = undefined;
});

describe("RadgivningEntryWarning", () => {
  it("visas när rådgivningsfakturan saknar låst post", () => {
    statusQuery.data = MISSING;
    render(<RadgivningEntryWarning matterId={matterId} paymentMethod="RATTSHJALP" />);
    expect(screen.getByRole("status").textContent).toContain("Rådgivningsfakturan saknar låst rådgivningspost");
    expect(statusUseQuery).toHaveBeenCalledWith({ matterId }, { enabled: true });
  });

  it("visas inte när posten finns", () => {
    statusQuery.data = { kind: "present", invoiceId: "inv-r" };
    const { container } = render(<RadgivningEntryWarning matterId={matterId} paymentMethod="RATTSHJALP" />);
    expect(container.textContent).toBe("");
  });

  it("frågar inte ens utanför rättshjälp", () => {
    const { container } = render(<RadgivningEntryWarning matterId={matterId} paymentMethod="PRIVAT" />);
    expect(container.textContent).toBe("");
    expect(statusUseQuery).toHaveBeenCalledWith({ matterId }, { enabled: false });
  });
});

describe("useMarkRadgivning", () => {
  it("canMark: bara olåst debiterbar tid i ett ärende som saknar posten", () => {
    statusQuery.data = MISSING;
    const { result } = renderHook(() => useMarkRadgivning(matterId, "RATTSHJALP"));
    expect(result.current.canMark({ billable: true })).toBe(true);
    expect(result.current.canMark({ billable: true, frozenAt: new Date() })).toBe(false);
    expect(result.current.canMark({ billable: false })).toBe(false);
  });

  it("canMark är false när status saknas", () => {
    const { result } = renderHook(() => useMarkRadgivning(matterId, "RATTSHJALP"));
    expect(result.current.canMark({ billable: true })).toBe(false);
  });

  it("lyckad markering invaliderar tid + fakturering", () => {
    renderHook(() => useMarkRadgivning(matterId, "RATTSHJALP"));
    mutationOpts!.onSuccess();
    expect(invalidateTimeEntry).toHaveBeenCalled();
    expect(invalidateBillingRun).toHaveBeenCalled();
  });

  it("misslyckad markering visas — aldrig tyst", () => {
    const alertSpy = vi.spyOn(globalThis, "alert").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useMarkRadgivning(matterId, "RATTSHJALP"));
    mutationOpts!.onError({ message: "Ärendet har redan en låst rådgivningspost." });
    expect(alertSpy).toHaveBeenCalledWith("Kunde inte markera: Ärendet har redan en låst rådgivningspost.");
    alertSpy.mockRestore();
    errSpy.mockRestore();
  });
});
