/**
 * Tester för ExpectedReceivablesSection (#27 coverage / #173) — förväntade
 * domstolsbetalningar: registrera fordran, avprickning
 * (markera mottagen) + avbryt, samt list-/tomtillstånd.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { ExpectedReceivablesSection } from "@/app/matters/[id]/_expected-receivables-section";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../../helpers/trpc-fake";

let rows: unknown[] = [];
const LIST = 'expectedReceivable.list {"matterId":"m1"}';

const handlers: TrpcHandlers = {
  "expectedReceivable.list": () => rows,
  "expectedReceivable.create": () => ({ id: "er-ny" }),
  "expectedReceivable.settle": () => ({ id: "er-1" }),
  "expectedReceivable.cancel": () => ({ id: "er-1" }),
};

beforeEach(() => { rows = []; });

/** Renderar sektionen och väntar tills listan har lästs. */
async function renderSection(isCourtMatter: boolean) {
  const fake = fakeTrpcLink(handlers);
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>
      <ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter={isCourtMatter} />
    </TrpcTestProvider>,
  );
  await waitFor(() => expect(fake.calls).toHaveLength(1));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return { ...view, fake, invalidate };
}

const inputsTo = (calls: ReadonlyArray<{ path: string; input: unknown }>, path: string) =>
  calls.filter((c) => c.path === path).map((c) => c.input);

describe("ExpectedReceivablesSection", () => {
  it("tomtillstånd när inga fordringar finns", async () => {
    await renderSection(true);
    expect(screen.getByText(/Inga registrerade ännu/)).toBeInTheDocument();
  });

  it("icke-domstolsärende utan fordringar → döljs helt (ej förvirrande)", async () => {
    const { container } = await renderSection(false);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Domstolsbetalningar/)).not.toBeInTheDocument();
  });

  it("icke-domstolsärende MEN med registrerad fordran → visas ändå (strandar inte data)", async () => {
    rows = [{ id: "er-1", description: "Mål B 1-26", expectedAmount: 200_000, status: "PENDING" }];
    await renderSection(false);
    expect(screen.getByText(/Domstolsbetalningar/)).toBeInTheDocument();
    expect(screen.getByText("Mål B 1-26")).toBeInTheDocument();
  });

  it("registrera fordran skickar description + belopp i öre, tömmer formuläret och läser om listan", async () => {
    const { fake, invalidate } = await renderSection(true);
    fireEvent.change(screen.getByPlaceholderText(/Kostnadsräkning/), { target: { value: "Svea HovR" } });
    fireEvent.change(screen.getByPlaceholderText(/Begärt belopp/), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till fordran" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual([LIST]));
    expect(inputsTo(fake.calls, "expectedReceivable.create")).toEqual([{ matterId: "m1", description: "Svea HovR", expectedAmount: 150_000 }]);
    expect(screen.getByPlaceholderText(/Kostnadsräkning/)).toHaveValue("");
  });

  it("PENDING-rad: markera mottagen bokar utbetalt belopp, avbryt avbryter", async () => {
    rows = [{ id: "er-1", description: "Mål B 1-26", expectedAmount: 200_000, status: "PENDING" }];
    const { fake, invalidate } = await renderSection(true);
    fireEvent.change(screen.getByPlaceholderText("Utbetalt (kr)"), { target: { value: "1800" } });
    fireEvent.click(screen.getByRole("button", { name: "Markera mottagen" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual([LIST]));
    expect(inputsTo(fake.calls, "expectedReceivable.settle")).toEqual([{ id: "er-1", settledAmount: 180_000 }]);
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual([LIST, LIST]));
    expect(inputsTo(fake.calls, "expectedReceivable.cancel")).toEqual([{ id: "er-1" }]);
  });

  it("SETTLED-rad visar mottaget belopp och ingen avprickning", async () => {
    rows = [{ id: "er-2", description: "Mål B 2-26", expectedAmount: 200_000, status: "SETTLED", settledAmount: 190_000 }];
    await renderSection(true);
    expect(screen.getByText(/Mottaget:/)).toBeInTheDocument();
    expect(screen.getByText("Mottagen")).toBeInTheDocument(); // status-label
    expect(screen.queryByRole("button", { name: "Markera mottagen" })).not.toBeInTheDocument();
  });
});
