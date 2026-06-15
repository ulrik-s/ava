/**
 * Tester för BillingDialog (#27 coverage) — ACCONTO- + FINAL-flödena:
 * procent↔bips-konvertering, belopp→öre, mottagar-val, acconto-avdrag och
 * submit-payloads till billingRun-mutationerna.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingDialog } from "@/app/matters/[id]/_billing-dialog";

const accontoMutate = vi.fn();
const finalMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    billingRun: {
      createAcconto: { useMutation: () => ({ mutate: accontoMutate, isPending: false, error: null }) },
      createFinal: { useMutation: () => ({ mutate: finalMutate, isPending: false, error: null }) },
    },
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("BillingDialog — ACCONTO", () => {
  it("submit skickar bips + öre + KLIENT (default 20 % / 2000 kr)", () => {
    render(<BillingDialog matterId="m1" type="ACCONTO" existingAccontos={[]} onClose={() => {}} />);
    expect(screen.getByText("Aconto till klient")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith({
      matterId: "m1", clientShareBips: 2000, amountOre: 200_000, recipient: "KLIENT",
    });
  });

  it("procent → bips: 30 % → 3000 bips", () => {
    render(<BillingDialog matterId="m1" type="ACCONTO" existingAccontos={[]} onClose={() => {}} />);
    const [percent] = screen.getAllByRole("spinbutton");
    fireEvent.change(percent!, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith(expect.objectContaining({ clientShareBips: 3000 }));
  });
});

describe("BillingDialog — FINAL", () => {
  const accontos = [
    { id: "br-1", amountOre: 100_000, recipient: "KLIENT" },
    { id: "br-2", amountOre: 50_000, recipient: "KLIENT" },
  ];

  it("default: alla aconton förvalda, submit drar av dem alla", () => {
    render(<BillingDialog matterId="m1" type="FINAL" existingAccontos={accontos} onClose={() => {}} />);
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith({
      matterId: "m1", recipient: "KLIENT", deductedBillingRunIds: ["br-1", "br-2"],
    });
  });

  it("avmarkera ett aconto → utesluts ur avdragen", () => {
    render(<BillingDialog matterId="m1" type="FINAL" existingAccontos={accontos} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!); // avmarkera br-1
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith(expect.objectContaining({ deductedBillingRunIds: ["br-2"] }));
  });

  it("byt mottagare → skickas i payloaden", () => {
    render(<BillingDialog matterId="m1" type="FINAL" existingAccontos={[]} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "FORSAKRING" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith(expect.objectContaining({ recipient: "FORSAKRING" }));
  });
});
