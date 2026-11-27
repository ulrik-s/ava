/**
 * Båda tRPC-bindningarna delar klient och cache (#1926, ADR 0041): en
 * mutation på det nya sättet som invaliderar med `queryFilter()` gör att en
 * klassisk `trpc.x.useQuery` hämtar om.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { TrpcProviders } from "@/components/shell/trpc-providers";
import { trpc, useTRPC, useTRPCClient } from "@/lib/client/trpc";
import { fakeTrpcClient, fakeTrpcLink, testQueryClient } from "../../helpers/trpc-fake";
import { mutationDefaultsProbe } from "../../helpers/trpc-mutation-defaults";

function ClassicReader() {
  const q = trpc.prefs.get.useQuery({ key: "k" });
  const n = q.data?.user?.["n"];
  return <p>värde: {typeof n === "number" ? n : "–"}</p>;
}

function NewClearer() {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const clear = useMutation(t.prefs.clear.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries(t.prefs.get.queryFilter()),
  }));
  return <button onClick={() => clear.mutate({ key: "k" })}>rensa</button>;
}

function RawClientUser() {
  const client = useTRPCClient();
  return <button onClick={() => void client.prefs.clear.mutate({ key: "rå" })}>rått</button>;
}

function setup() {
  let n = 0;
  const fake = fakeTrpcLink({
    "prefs.get": () => ({ user: { n: ++n }, org: null }),
    "prefs.clear": () => ({ ok: true }),
  });
  render(
    <TrpcProviders trpcClient={fakeTrpcClient(fake.link)} queryClient={testQueryClient()}>
      <ClassicReader />
      <NewClearer />
      <RawClientUser />
    </TrpcProviders>,
  );
  return fake;
}

describe("TrpcProviders – en klient och en cache för båda bindningarna", () => {
  it("en ny mutation som invaliderar får den klassiska frågan att hämta om", async () => {
    const fake = setup();
    await screen.findByText("värde: 1");
    fireEvent.click(screen.getByText("rensa"));
    await screen.findByText("värde: 2");
    expect(fake.calls.map((c) => c.path)).toEqual(["prefs.get", "prefs.clear", "prefs.get"]);
  });

  it("useTRPCClient ger samma klient", async () => {
    const fake = setup();
    await screen.findByText("värde: 1");
    fireEvent.click(screen.getByText("rått"));
    await waitFor(() => expect(fake.calls.at(-1)).toEqual({ path: "prefs.clear", type: "mutation", input: { key: "rå" } }));
  });

  it("den nya bindningen får samma QueryClient (mutationsstandarder når fram)", async () => {
    const qc = testQueryClient();
    const { onSuccess, Probe } = mutationDefaultsProbe(qc);
    const fake = fakeTrpcLink({ "prefs.clear": () => ({ ok: true }) });
    render(
      <TrpcProviders trpcClient={fakeTrpcClient(fake.link)} queryClient={qc}>
        <Probe />
      </TrpcProviders>,
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
