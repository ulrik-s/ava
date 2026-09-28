/**
 * `makeAppQueryClient` — appens QueryClient (#1241).
 *
 * Procedurerna körs i klienten mot den lokala storen (ADR 0016), så en fråga
 * eller mutation behöver INTE nätet. TanStack Querys standard
 * (`networkMode: "online"`) pausade ändå allt så fort webbläsaren gick
 * offline: "Sparar…" hängde tills nätet kom tillbaka, och ändringen hamnade
 * aldrig i den lokala kön. Offline-first kräver `networkMode: "always"`.
 */
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest-compat";
import { makeAppQueryClient } from "@/lib/client/query-client";

afterEach(() => { onlineManager.setOnline(true); });

describe("makeAppQueryClient", () => {
  it("en mutation körs även när webbläsaren är offline", async () => {
    onlineManager.setOnline(false);
    const client = makeAppQueryClient();
    const result = await client.getMutationCache().build(client, { mutationFn: async () => "sparad lokalt" }).execute(undefined);
    expect(result).toBe("sparad lokalt");
  });

  it("en fråga körs även offline (läser den lokala storen)", async () => {
    onlineManager.setOnline(false);
    const client = makeAppQueryClient();
    await expect(client.fetchQuery({ queryKey: ["x"], queryFn: async () => 42 })).resolves.toBe(42);
  });

  it("kontroll: med TanStacks standardläge pausas mutationen offline", async () => {
    onlineManager.setOnline(false);
    const { QueryClient } = await import("@tanstack/react-query");
    const client = new QueryClient();
    const mutation = client.getMutationCache().build(client, { mutationFn: async () => "x" });
    const settled = await Promise.race([mutation.execute(undefined).then(() => "körd"), new Promise((r) => setTimeout(() => r("pausad"), 50))]);
    expect(settled).toBe("pausad");
  });

  it("behåller appens övriga standardval (ingen retry, ingen refetch vid fokus)", () => {
    const defaults = makeAppQueryClient().getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBe(60_000);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
