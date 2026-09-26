/**
 * `useDocumentSearch` (#1215): omfånget väljer källa — servern frågas direkt
 * (Postgres-fulltext), demon kör in-process-routern, offline frågar ingen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const serverCalls: unknown[] = [];
const localCalls: Array<{ input: unknown; enabled: boolean }> = [];
const localResult = { data: { hits: [], totalHits: 0, source: "local" }, isFetching: false, error: null };

vi.mock("@trpc/client", () => ({
  httpBatchLink: () => ({}),
  createTRPCClient: () => ({
    document: { search: { query: async (input: unknown) => { serverCalls.push(input); return { hits: [], totalHits: 0, source: "server" }; } } },
  }),
}));
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: {
      search: {
        useQuery: (input: unknown, opts: { enabled: boolean }) => { localCalls.push({ input, enabled: opts.enabled }); return localResult; },
      },
    },
  },
}));

const { useDocumentSearch } = await import("@/lib/client/search/use-document-search");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  serverCalls.length = 0;
  localCalls.length = 0;
});

describe("useDocumentSearch", () => {
  it("server-omfång: frågar serverns document.search direkt, inte in-process-routern", async () => {
    const input = { query: "stämning", documentTypes: ["DOM"] };
    const { result } = renderHook(() => useDocumentSearch(input, "server"), { wrapper });
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "server" }));
    expect(serverCalls).toEqual([input]);
    expect(localCalls.every((c) => !c.enabled)).toBe(true);
  });

  it("lokalt omfång (demo): in-process-routern, servern frågas inte", () => {
    const { result } = renderHook(() => useDocumentSearch({ query: "x" }, "local"), { wrapper });
    expect(result.current.data).toMatchObject({ source: "local" });
    expect(localCalls.at(-1)).toEqual({ input: { query: "x" }, enabled: true });
    expect(serverCalls).toEqual([]);
  });

  it("offline: ingen fråga alls", () => {
    renderHook(() => useDocumentSearch({ query: "x" }, "offline"), { wrapper });
    expect(localCalls.every((c) => !c.enabled)).toBe(true);
    expect(serverCalls).toEqual([]);
  });

  it("tom söksträng: ingen fråga i något omfång", () => {
    renderHook(() => useDocumentSearch({ query: "" }, "server"), { wrapper });
    renderHook(() => useDocumentSearch({ query: "" }, "local"), { wrapper });
    expect(localCalls.every((c) => !c.enabled)).toBe(true);
    expect(serverCalls).toEqual([]);
  });
});
