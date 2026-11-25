/** Testhjälparen för den nya tRPC-bindningen (#1926). */
import { useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { useTRPC } from "@/lib/client/trpc";
import { fakeTrpcClient, fakeTrpcLink, testQueryClient, TrpcTestProvider } from "../../../helpers/trpc-fake";

describe("fakeTrpcLink", () => {
  it("svarar per väg och sparar anropen", async () => {
    const fake = fakeTrpcLink({ "prefs.get": (input) => ({ user: input, org: null }) });
    const client = fakeTrpcClient(fake.link);
    await expect(client.prefs.get.query({ key: "a" })).resolves.toEqual({ user: { key: "a" }, org: null });
    expect(fake.calls).toEqual([{ path: "prefs.get", type: "query", input: { key: "a" } }]);
  });

  it("en väg utan svar ger ett fel som nämner vägen", async () => {
    const client = fakeTrpcClient(fakeTrpcLink({}).link);
    await expect(client.prefs.get.query({ key: "a" })).rejects.toThrow("inget svar för prefs.get");
  });

  it("ett handlerfel når anroparen, också när det inte är ett Error", async () => {
    const fake = fakeTrpcLink({
      "prefs.clear": () => { throw new Error("trasigt"); },
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- hjälparen ska tåla ett fel som inte är ett Error
      "prefs.get": () => Promise.reject("bara text"),
    });
    const client = fakeTrpcClient(fake.link);
    await expect(client.prefs.clear.mutate({ key: "a" })).rejects.toThrow("trasigt");
    await expect(client.prefs.get.query({ key: "a" })).rejects.toThrow("bara text");
  });
});

describe("testQueryClient", () => {
  it("gör inga omförsök", () => {
    const qc = testQueryClient();
    expect(qc.getDefaultOptions().queries?.retry).toBe(false);
    expect(qc.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

function Reader() {
  const trpc = useTRPC();
  const q = useQuery(trpc.prefs.get.queryOptions({ key: "k" }));
  return <p>{q.data ? `org: ${q.data.org === null ? "null" : "satt"}` : "laddar"}</p>;
}

describe("TrpcTestProvider", () => {
  it("ger useTRPC en klient över länken", async () => {
    const fake = fakeTrpcLink({ "prefs.get": () => ({ user: null, org: null }) });
    render(<TrpcTestProvider link={fake.link}><Reader /></TrpcTestProvider>);
    await screen.findByText("org: null");
  });

  it("använder en given QueryClient", async () => {
    const qc = testQueryClient();
    const fake = fakeTrpcLink({ "prefs.get": () => ({ user: null, org: { x: 1 } }) });
    render(<TrpcTestProvider link={fake.link} queryClient={qc}><Reader /></TrpcTestProvider>);
    await screen.findByText("org: satt");
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
  });
});
