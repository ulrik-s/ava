/**
 * `PaymentTermSection` (#2265) — byråns betalningsvillkor i dagar. Sparas med
 * Spara; tomt fält = standard (`null`, tio dagar); 0–365 som servern.
 * Den nya tRPC-bindningen (ADR 0041) prövas mot `TrpcTestProvider`.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { isValidPaymentTerm, PaymentTermSection, toPaymentTermPatch } from "@/app/settings/_payment-term-section";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../../helpers/trpc-fake";

function setup(saved: { paymentTermDays?: number | null } = {}, update: TrpcHandlers[string] = () => ({})) {
  const fake = fakeTrpcLink({ "organization.getSettings": () => saved, "organization.updateSettings": update });
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}><PaymentTermSection /></TrpcTestProvider>);
  return { fake, invalidate };
}

const field = (): Promise<HTMLInputElement> => screen.findByLabelText<HTMLInputElement>("Betalningsvillkor (dagar)");
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "Spara" });
const updates = (fake: ReturnType<typeof fakeTrpcLink>) => fake.calls.filter((c) => c.path === "organization.updateSettings");

afterEach(() => { vi.restoreAllMocks(); });

describe("PaymentTermSection (#2265)", () => {
  it("visar Laddar… tills inställningarna finns", () => {
    setup();
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spara" })).toBeNull();
  });

  it("byråns sparade villkor står i fältet", async () => {
    setup({ paymentTermDays: 30 });
    expect((await field()).value).toBe("30");
  });

  it("tomt fält visar standarden i platshållaren och hjälptexten", async () => {
    setup({ paymentTermDays: null });
    const input = await field();
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Standard: 10 dagar");
    expect(screen.getByText(/Tomt fält = standard: 10 dagar\./)).toBeInTheDocument();
  });

  it("Spara skickar hela dagar och hämtar inställningarna om", async () => {
    const { fake, invalidate } = setup();
    fireEvent.change(await field(), { target: { value: "30" } });
    fireEvent.click(saveButton());
    await screen.findByText("Sparat ✓");
    expect(updates(fake).map((c) => c.input)).toEqual([{ paymentTermDays: 30 }]);
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(["organization.getSettings"]));
  });

  it("ett tömt fält sparas som null (tillbaka till standard); Sparat ✓ försvinner vid ändring", async () => {
    const { fake } = setup({ paymentTermDays: 20 });
    fireEvent.change(await field(), { target: { value: "" } });
    fireEvent.click(saveButton());
    await screen.findByText("Sparat ✓");
    expect(updates(fake).map((c) => c.input)).toEqual([{ paymentTermDays: null }]);
    fireEvent.change(await field(), { target: { value: "5" } });
    expect(screen.queryByText("Sparat ✓")).toBeNull();
  });

  it("fler än 365 dagar sparas inte; felet syns tills fältet ändras", async () => {
    const { fake } = setup();
    fireEvent.change(await field(), { target: { value: "366" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Ange 0–365 dagar")).toBeInTheDocument();
    expect(updates(fake)).toEqual([]);
    fireEvent.change(await field(), { target: { value: "365" } });
    expect(screen.queryByText("Ange 0–365 dagar")).toBeNull();
  });

  it("visar Sparar… medan anropet pågår, med knappen avstängd", async () => {
    setup({}, () => new Promise(() => {}));
    await field();
    fireEvent.click(saveButton());
    expect(await screen.findByText("Sparar…")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("serverns fel visas bredvid knappen", async () => {
    setup({}, () => { throw new Error("Endast administratörer kan ändra byråns uppgifter"); });
    await field();
    fireEvent.click(saveButton());
    expect(await screen.findByText("Endast administratörer kan ändra byråns uppgifter")).toBeInTheDocument();
  });
});

describe("toPaymentTermPatch / isValidPaymentTerm (#2265)", () => {
  it("null är standard, 0 är ett värde, decimaler avrundas till hela dagar", () => {
    expect(toPaymentTermPatch(null)).toEqual({ paymentTermDays: null });
    expect(toPaymentTermPatch(0)).toEqual({ paymentTermDays: 0 });
    expect(toPaymentTermPatch(14.6)).toEqual({ paymentTermDays: 15 });
  });

  it("null och 0–365 går igenom, inte 366 eller decimaler", () => {
    expect(isValidPaymentTerm(null)).toBe(true);
    expect(isValidPaymentTerm(0)).toBe(true);
    expect(isValidPaymentTerm(365)).toBe(true);
    expect(isValidPaymentTerm(366)).toBe(false);
    expect(isValidPaymentTerm(1.5)).toBe(false);
  });
});
