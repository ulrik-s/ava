/**
 * `useDocumentSearch` (#1215): omfånget väljer källa — servern frågas direkt
 * (Postgres-fulltext), demon kör in-process-routern, och offline söker den
 * i det som finns på enheten (#1244) — samma in-process-router.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { callsTo } from "../../../helpers/trpc-both-fake";
import { fakeTrpcWrapper, type FakeTrpcWrapper } from "../../../helpers/trpc-fake";

const serverCalls: unknown[] = [];

vi.mock("@/lib/client/backend/server-trpc-client", () => ({
  serverTrpcClient: () => ({
    document: { search: { query: async (input: unknown) => { serverCalls.push(input); return { hits: [], totalHits: 0, source: "server" }; } } },
  }),
}));

const { useDocumentSearch } = await import("@/lib/client/search/use-document-search");

/** In-process-routern (den nya bindningen) över en fejkad länk; sparar anropen. */
let local: FakeTrpcWrapper;

beforeEach(() => {
  serverCalls.length = 0;
  local = fakeTrpcWrapper({ "document.search": () => ({ hits: [], totalHits: 0, source: "local" }) });
});

/** Anropen till in-process-routerns `document.search`. */
const localCalls = (): unknown[] => callsTo(local.fake, "document.search");

describe("useDocumentSearch", () => {
  it("server-omfång: frågar serverns document.search direkt, inte in-process-routern", async () => {
    const input = { query: "stämning", documentTypes: ["DOM"] };
    const { result } = renderHook(() => useDocumentSearch(input, "server"), { wrapper: local.wrapper });
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "server" }));
    expect(serverCalls).toEqual([input]);
    expect(localCalls()).toEqual([]);
  });

  it("lokalt omfång (demo): in-process-routern, servern frågas inte", async () => {
    const { result } = renderHook(() => useDocumentSearch({ query: "x" }, "local"), { wrapper: local.wrapper });
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "local" }));
    expect(localCalls()).toEqual([{ query: "x" }]);
    expect(serverCalls).toEqual([]);
  });

  it("offline: söker på enheten (in-process-routern), servern frågas inte (#1244)", async () => {
    const { result } = renderHook(() => useDocumentSearch({ query: "x" }, "offline"), { wrapper: local.wrapper });
    await waitFor(() => expect(result.current.data).toMatchObject({ source: "local" }));
    expect(localCalls()).toEqual([{ query: "x" }]);
    expect(serverCalls).toEqual([]);
  });

  it("tom söksträng: ingen fråga i något omfång", async () => {
    renderHook(() => useDocumentSearch({ query: "" }, "server"), { wrapper: local.wrapper });
    renderHook(() => useDocumentSearch({ query: "" }, "local"), { wrapper: local.wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(localCalls()).toEqual([]);
    expect(serverCalls).toEqual([]);
  });
});
