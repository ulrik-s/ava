import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { asId } from "@/lib/shared/schemas/ids";

const calls: string[] = [];
const caps = { ledger: true };
let bookResult: Promise<unknown> = Promise.resolve({ externalId: "A/1", payments: [] });
let flushError: Error | null = null;

vi.mock("@trpc/client", () => ({
  httpBatchLink: () => ({}),
  createTRPCClient: () => ({
    ledger: {
      status: { query: async () => { calls.push("status"); return { configured: true, connected: true }; } },
      connectUrl: { mutate: async () => { calls.push("connectUrl"); return { url: "https://fortnox.test/auth" }; } },
      completeConnect: { mutate: async (i: unknown) => { calls.push(`complete:${JSON.stringify(i)}`); return { connected: true }; } },
      bookInvoice: { mutate: async () => { calls.push("book"); return bookResult; } },
    },
  }),
}));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => caps }));
vi.mock("@/lib/client/sync/server-sync-flush", () => ({
  flushServerSync: async () => { calls.push("flush"); if (flushError) throw flushError; },
}));

const { useBookInvoice, useCompleteLedgerConnect, useConnectLedger, useLedgerStatus } = await import("@/lib/client/backend/server-ledger");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  calls.length = 0;
  caps.ledger = true;
  flushError = null;
  bookResult = Promise.resolve({ externalId: "A/1", payments: [] });
});

describe("server-ledger", () => {
  it("status hämtas från servern när ledger-kapabiliteten finns", async () => {
    const { result } = renderHook(() => useLedgerStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ configured: true, connected: true }));
  });

  it("utan kapabilitet (demo) frågas servern inte", () => {
    caps.ledger = false;
    const { result } = renderHook(() => useLedgerStatus(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(calls).not.toContain("status");
  });

  it("anslut skickar vidare till Fortnox", async () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, assign }, configurable: true });
    const { result } = renderHook(() => useConnectLedger(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(assign).toHaveBeenCalledWith("https://fortnox.test/auth");
    Object.defineProperty(window, "location", { value: orig, configurable: true });
  });

  it("slutför anslutningen med code + state", async () => {
    const { result } = renderHook(() => useCompleteLedgerConnect(), { wrapper });
    await act(() => result.current.mutateAsync({ code: "c", state: "s" }));
    expect(calls).toContain('complete:{"code":"c","state":"s"}');
  });

  it("bokföring: synk → bokför → synk → klar", async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useBookInvoice(asId<"InvoiceId">("i1"), onDone), { wrapper });
    await act(() => result.current.mutateAsync());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls).toEqual(["flush", "book", "flush"]);
  });

  it("osynkade ändringar → ingen bokföring, felet syns, klar ändå", async () => {
    flushError = new Error("inte nått servern");
    const onDone = vi.fn();
    const { result } = renderHook(() => useBookInvoice(asId<"InvoiceId">("i1"), onDone), { wrapper });
    await act(async () => { await result.current.mutateAsync().catch(() => undefined); });
    await waitFor(() => expect(result.current.error?.message).toBe("inte nått servern"));
    expect(calls).not.toContain("book");
    expect(onDone).toHaveBeenCalled();
  });
});
