/**
 * `WatchlistThresholdsSection` (#1912) — byråns trösklar för "Bör faktureras".
 * Två fält sparas tillsammans med Spara; tomt fält = standard (`null`).
 * Den nya tRPC-bindningen (ADR 0041) prövas mot `TrpcTestProvider`.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import {
  toThresholdDraft, toThresholdPatch, WatchlistThresholdsSection,
} from "@/app/settings/_watchlist-thresholds-section";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../../helpers/trpc-fake";

interface Saved { unbilledThresholdOre?: number | null; unbilledAgeDays?: number | null }

function setup(saved: Saved = {}, update: TrpcHandlers[string] = () => ({})) {
  const fake = fakeTrpcLink({ "organization.getSettings": () => saved, "organization.updateSettings": update });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}><WatchlistThresholdsSection /></TrpcTestProvider>);
  return { fake, invalidate };
}

/** Procedurvägarna som invaliderats, t.ex. "watchlist.list". */
function invalidated(spy: { mock: { calls: ReadonlyArray<readonly unknown[]> } }): string[] {
  return spy.mock.calls.map((c) => {
    const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey ?? [];
    return (key[0] as string[] | undefined)?.join(".") ?? "";
  }).sort();
}

const amount = (): Promise<HTMLInputElement> => screen.findByLabelText<HTMLInputElement>("Ofakturerat belopp (kr)");
const age = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>("Äldsta ofakturerade (dagar)");
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "Spara" });
const updates = (fake: ReturnType<typeof fakeTrpcLink>) => fake.calls.filter((c) => c.path === "organization.updateSettings");

afterEach(() => { vi.restoreAllMocks(); });

describe("WatchlistThresholdsSection (#1912)", () => {
  it("visar Laddar… tills inställningarna finns", () => {
    setup();
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spara" })).toBeNull();
  });

  it("byråns sparade värden står i fälten, i kronor och dagar", async () => {
    setup({ unbilledThresholdOre: 1_000_050, unbilledAgeDays: 30 });
    expect((await amount()).value).toBe("10000.5");
    expect(age().value).toBe("30");
  });

  it("tomma fält visar standard i platshållaren, och hjälptexten finns", async () => {
    setup();
    const field = await amount();
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("standard: 25 000 kr");
    expect(age().placeholder).toBe("standard: 60 dagar");
    expect(screen.getByText(/Bör faktureras visas när beloppet eller åldern nås\. Tomt fält = standard\./)).toBeInTheDocument();
  });

  it("Spara skickar båda fälten i ett anrop, i hela öre och hela dagar", async () => {
    const { fake } = setup();
    fireEvent.change(await amount(), { target: { value: "1 234,567" } });
    fireEvent.change(age(), { target: { value: "45,4" } });
    fireEvent.click(saveButton());
    await screen.findByText("Sparat ✓");
    expect(updates(fake).map((c) => c.input)).toEqual([{ unbilledThresholdOre: 123_457, unbilledAgeDays: 45 }]);
  });

  it("ett tömt fält sparas som null", async () => {
    const { fake } = setup({ unbilledThresholdOre: 500_000, unbilledAgeDays: 10 });
    fireEvent.change(await amount(), { target: { value: "" } });
    fireEvent.click(saveButton());
    await screen.findByText("Sparat ✓");
    expect(updates(fake).map((c) => c.input)).toEqual([{ unbilledThresholdOre: null, unbilledAgeDays: 10 }]);
  });

  it("efter sparandet hämtas inställningarna och Frister om; Sparat ✓ försvinner vid nästa ändring", async () => {
    const { invalidate } = setup();
    await amount();
    expect(screen.queryByText("Sparat ✓")).toBeNull();
    fireEvent.click(saveButton());
    await screen.findByText("Sparat ✓");
    await waitFor(() => expect(invalidated(invalidate)).toEqual(["organization.getSettings", "watchlist.list"]));
    fireEvent.change(age(), { target: { value: "7" } });
    expect(screen.queryByText("Sparat ✓")).toBeNull();
  });

  it("visar Sparar… medan anropet pågår, med knappen avstängd", async () => {
    setup({}, () => new Promise(() => {}));
    await amount();
    fireEvent.click(saveButton());
    expect(await screen.findByText("Sparar…")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("serverns fel visas bredvid knappen", async () => {
    setup({}, () => { throw new Error("Endast administratörer får ändra inställningarna"); });
    await amount();
    fireEvent.click(saveButton());
    expect(await screen.findByText("Endast administratörer får ändra inställningarna")).toBeInTheDocument();
    expect(screen.queryByText("Sparat ✓")).toBeNull();
  });
});

describe("toThresholdDraft / toThresholdPatch (#1912)", () => {
  it("null står kvar som tomt fält åt båda hållen", () => {
    expect(toThresholdDraft({ unbilledThresholdOre: null, unbilledAgeDays: null })).toEqual({ amountKr: null, ageDays: null });
    expect(toThresholdPatch({ amountKr: null, ageDays: null })).toEqual({ unbilledThresholdOre: null, unbilledAgeDays: null });
  });

  it("0 är ett värde, inte standard", () => {
    expect(toThresholdDraft({ unbilledThresholdOre: 0, unbilledAgeDays: 0 })).toEqual({ amountKr: 0, ageDays: 0 });
    expect(toThresholdPatch({ amountKr: 0, ageDays: 0 })).toEqual({ unbilledThresholdOre: 0, unbilledAgeDays: 0 });
  });
});
