/**
 * Komponenttest för PaymentMethodCard. Verifierar att rätt label + kreditrisk
 * renderas för varje paymentMethod-värde, plus att en notering syns när satt
 * och att klientens %-andel visas/redigeras vid rättshjälp/rättsskydd (#778).
 *
 * Vi mockar trpc-hooken så testet inte behöver en riktig server.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { PaymentMethodCard } from "@/components/matter/payment-method-card";
import { asId } from "@/lib/shared/schemas/ids";

const updateMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
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
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote="Diarienr RH-2026-0217"
        paymentMethodDecidedAt={new Date("2026-03-02")}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText("Rättshjälp")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Låg/i)).toBeInTheDocument();
    expect(screen.getByText(/Diarienr RH-2026-0217/)).toBeInTheDocument();
  });

  it("visar 'Privat betalning' med hög kreditrisk-badge", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="PRIVAT"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText("Privat betalning")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Hög/i)).toBeInTheDocument();
  });

  it("visar 'Ej fastställt' med okänd kreditrisk när paymentMethod=PENDING", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="PENDING"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText("Ej fastställt")).toBeInTheDocument();
    expect(screen.getByText(/Kreditrisk: Okänd/i)).toBeInTheDocument();
  });

  it("visar Ändra-knappen för redigering", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSSKYDD"
        paymentMethodNote="Trygg-Hansa"
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByRole("button", { name: /Ändra/i })).toBeInTheDocument();
  });

  it("klick på Ändra öppnar redigeringsformuläret", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    expect(screen.getByText(/Ändra betalningssätt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Spara$/i })).toBeInTheDocument();
  });

  it("Avbryt stänger redigeringsformuläret", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Avbryt$/i }));
    expect(screen.queryByRole("button", { name: /^Spara$/i })).not.toBeInTheDocument();
  });

  it("byter betalningssätt och submittar", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
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
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={new Date("2026-04-15")}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText(/Beslut mottaget/)).toBeInTheDocument();
  });

  it("visar klientens andel som procent vid rättsskydd (#778)", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSSKYDD"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={2500}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText(/Klientens andel: 25 %/)).toBeInTheDocument();
  });

  it("visar 'ej satt' när andelen saknas men metoden använder %-sats (#778)", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSHJALP"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={null}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    expect(screen.getByText(/Klientens andel: ej satt/)).toBeInTheDocument();
  });

  it("redigerar och sparar klientens %-andel som bips (#778)", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSSKYDD"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={2000}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    const shareInput = screen.getByPlaceholderText(/t\.ex\. 25/i) as HTMLInputElement;
    expect(shareInput.value).toBe("20");
    fireEvent.change(shareInput, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", clientShareBips: 3000 }),
    );
  });

  it("tomt andels-fält sparas som null (#778)", () => {
    render(
      <PaymentMethodCard
        matterId={asId<"MatterId">("m1")}
        paymentMethod="RATTSSKYDD"
        paymentMethodNote={null}
        paymentMethodDecidedAt={null}
        clientShareBips={2000}
        rattsskyddMaxOre={null}
        rattshjalpMaxTimmar={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ändra/i }));
    const shareInput = screen.getByPlaceholderText(/t\.ex\. 25/i) as HTMLInputElement;
    fireEvent.change(shareInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", clientShareBips: null }),
    );
  });
});
