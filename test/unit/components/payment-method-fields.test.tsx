/**
 * Komponenttest för `PaymentMethodFields` (#1564): styrda betalningsfält utan
 * egen sparknapp. Varje fält anropar `onChange` med hela värdet, där bara det
 * ändrade fältet är nytt.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { PaymentMethodFields, usesClientShare } from "@/components/matter/payment-method-fields";
import type { PaymentMethodFormValues } from "@/components/matter/use-payment-method-form";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    organization: {
      getSettings: { useQuery: () => ({ data: { hourlyRates: { ARBETE: 250000 } } }) },
    },
  },
}));

const BASE: PaymentMethodFormValues = {
  method: "RATTSSKYDD", note: "", decidedAt: "", sharePct: "", rsMaxKr: "", rhMaxTim: "",
  tvist: "", beslut: "", nekad: "", rates: {},
};

const onChange = vi.fn();
beforeEach(() => onChange.mockReset());

function renderFields(over: Partial<PaymentMethodFormValues> = {}): PaymentMethodFormValues {
  const value = { ...BASE, ...over };
  render(<PaymentMethodFields value={value} onChange={onChange} />);
  return value;
}

describe("PaymentMethodFields", () => {
  it("har ingen egen spar- eller avbrytknapp", () => {
    renderFields();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("byte av betalningssätt anropar onChange med den nya metoden", () => {
    const value = renderFields();
    fireEvent.change(screen.getByLabelText("Betalningssätt"), { target: { value: "PRIVAT" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, method: "PRIVAT" });
  });

  it.each([
    [/Klientens andel att betala/, "25", "sharePct"],
    ["Tvist uppkom (datum)", "2026-01-05", "tvist"],
    ["Försäkringens beslut (datum)", "2026-02-01", "beslut"],
    ["Rättsskydd nekat (datum)", "2026-04-01", "nekad"],
    [/^Beslutsdatum/, "2026-03-02", "decidedAt"],
    [/^Notering/, "Bolag X", "note"],
  ] as const)("rättsskydd: fältet %s sätter %s", (label, input, key) => {
    const value = renderFields();
    fireEvent.change(screen.getByLabelText(label), { target: { value: input } });
    expect(onChange).toHaveBeenCalledWith({ ...value, [key]: input });
  });

  it("rättsskydd: taket matas in i kronor", () => {
    const value = renderFields();
    expect(screen.getByText("Försäkringens maxbelopp (kr)")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("t.ex. 75000"), { target: { value: "75000" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, rsMaxKr: "75000" });
  });

  it("rättshjälp: taket matas in i timmar och rättsskyddets datum saknas", () => {
    const value = renderFields({ method: "RATTSHJALP" });
    expect(screen.getByText("Rättshjälpens tak (timmar)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tvist uppkom (datum)")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("100"), { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, rhMaxTim: "120" });
  });

  it("privat: varken andel, tak eller rättsskyddets datum visas", () => {
    renderFields({ method: "PRIVAT" });
    expect(screen.queryByLabelText(/Klientens andel/)).toBeNull();
    expect(screen.queryByPlaceholderText("t.ex. 75000")).toBeNull();
    expect(screen.queryByPlaceholderText("100")).toBeNull();
    expect(screen.queryByLabelText("Tvist uppkom (datum)")).toBeNull();
  });

  it("ärendets timpris sätts som karta i öre", () => {
    const value = renderFields();
    fireEvent.change(screen.getByLabelText(/^Timarvode \(kr\/h/), { target: { value: "3000" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, rates: { ARBETE: 300000 } });
  });

  it("rättshjälp: takets hjälptext varnar vid 80 tim / 10 tim före utökat tak, inte vid 90 % (#1519)", () => {
    renderFields({ method: "RATTSHJALP" });
    expect(screen.getByText(/Varnar vid 80 tim, eller 10 tim före ett utökat tak/)).toBeInTheDocument();
    expect(screen.queryByText(/Varnar vid 90 %/)).toBeNull();
  });

  it("avvikande timpris är hopfällt utan egna priser; placeholdern visar byråns pris (#1206)", () => {
    renderFields();
    const details = screen.getByText("Avvikande timpris för ärendet").closest("details");
    expect(details?.open).toBe(false);
    const arbete = screen.getByLabelText<HTMLInputElement>(/^Timarvode \(kr\/h/);
    expect(arbete.placeholder).toMatch(/^ärvs: 2\s500 kr\/h$/);
  });

  it("ett befintligt pris öppnar sektionen; töms det försvinner kategorin ur kartan (#1206)", () => {
    const value = renderFields({ rates: { ARBETE: 300000, TIDSSPILLAN: 150000 } });
    expect(screen.getByText("Avvikande timpris för ärendet").closest("details")?.open).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Timarvode \(kr\/h/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, rates: { TIDSSPILLAN: 150000 } });
  });

  it("visar de inskickade värdena", () => {
    renderFields({ sharePct: "25", rsMaxKr: "75000", note: "Bolag X", tvist: "2026-01-05" });
    expect(screen.getByLabelText<HTMLInputElement>(/Klientens andel/).value).toBe("25");
    expect(screen.getByPlaceholderText<HTMLInputElement>("t.ex. 75000").value).toBe("75000");
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Notering/).value).toBe("Bolag X");
    expect(screen.getByLabelText<HTMLInputElement>("Tvist uppkom (datum)").value).toBe("2026-01-05");
  });
});

describe("usesClientShare", () => {
  it("gäller rättsskydd och rättshjälp, inte privat", () => {
    expect(usesClientShare("RATTSSKYDD")).toBe(true);
    expect(usesClientShare("RATTSHJALP")).toBe(true);
    expect(usesClientShare("PRIVAT")).toBe(false);
  });
});
