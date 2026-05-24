/**
 * Komponenttest för PaymentMethodCard. Verifierar att rätt label + kreditrisk
 * renderas för varje paymentMethod-värde, plus att en notering syns när satt.
 *
 * Vi mockar trpc-hooken så testet inte behöver en riktig server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentMethodCard } from "@/client/components/payment-method-card";

const updateMutate = vi.fn();

vi.mock("@/client/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ matter: { getById: { invalidate: vi.fn() } } }),
    matter: {
      update: {
        useMutation: () => ({ mutate: updateMutate, isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  updateMutate.mockReset();
});

describe("PaymentMethodCard", () => {
  it("visar 'Rättshjälp' med låg kreditrisk-badge", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSHJALP"
        paymentMethodNote="Diarienr RH-2026-0217"
        paymentMethodDecidedAt={new Date("2026-03-02")}
      />,
    );
    expect(screen.getByText("Rättshjälp")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Låg/i)).toBeInTheDocument();
    expect(screen.getByText(/Diarienr RH-2026-0217/)).toBeInTheDocument();
  });

  it("visar 'Privat betalning' med hög kreditrisk-badge", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="PRIVAT"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
      />,
    );
    expect(screen.getByText("Privat betalning")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Hög/i)).toBeInTheDocument();
  });

  it("visar 'Ej fastställt' med okänd kreditrisk när paymentMethod=PENDING", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="PENDING"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
      />,
    );
    expect(screen.getByText("Ej fastställt")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Okänd/i)).toBeInTheDocument();
  });

  it("visar Ändra-knappen för redigering", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSSKYDD"
        paymentMethodNote="Trygg-Hansa"
        paymentMethodDecidedAt={null}
      />,
    );
    expect(screen.getByRole("button", { name: /Ändra/i })).toBeInTheDocument();
  });

  it("klick på Ändra öppnar redigeringsformuläret", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    expect(screen.getByText(/Ändra betalningssätt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Spara$/i })).toBeInTheDocument();
  });

  it("Avbryt stänger redigeringsformuläret", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Avbryt$/i }));
    expect(screen.queryByRole("button", { name: /^Spara$/i })).not.toBeInTheDocument();
  });

  it("byter betalningssätt och submittar", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "PRIVAT" } });
    const noteArea = screen.getByPlaceholderText(/Trygg-Hansa/i) as HTMLTextAreaElement;
    fireEvent.change(noteArea, { target: { value: "Privatfaktura" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m1",
        paymentMethod: "PRIVAT",
        paymentMethodNote: "Privatfaktura",
      }),
    );
  });

  it("visar beslutsdatum när satt", () => {
    render(
      <PaymentMethodCard
        matterId="m1"
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={new Date("2026-04-15")}
      />,
    );
    expect(screen.getByText(/Beslut mottaget/)).toBeInTheDocument();
  });
});
