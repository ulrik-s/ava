/**
 * Tester för BillingDialog (#27/#397) — ACCONTO- + FINAL-flödena:
 * avdragsmedvetet aconto-förslag (%-sats × upparbetat − tidigare aconton),
 * ofakturerade-poster-listan i FINAL, procent↔bips, mottagar-val, acconto-
 * avdrag och faktura-dokument-generering på onSuccess.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingDialog } from "@/app/matters/[id]/_billing-dialog";
import { asId } from "@/lib/shared/schemas/ids";

const accontoMutate = vi.fn();
const finalMutate = vi.fn();
let accontoOnSuccess: ((res: unknown) => Promise<void>) | undefined;
let finalOnSuccess: ((res: unknown) => Promise<void>) | undefined;
const registerMutateAsync = vi.fn(async () => {});
const renderFakturaPdf = vi.fn(async () => new Uint8Array([1, 2, 3]));
const persistGeneratedDoc = vi.fn(async () => {});

let proposalData: unknown = {
  workValueOre: 500_000, // 5000 kr upparbetat
  priorAccontoSumOre: 0,
  timeEntries: [{ id: "te-1", description: "Möte med klient", minutes: 120, hourlyRate: 250_000, billable: true, valueOre: 500_000 }],
  expenses: [{ id: "ex-1", description: "Ansökningsavgift", amount: 90_000, billable: true }],
};
let proposalLoading = false;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { tree: { invalidate: vi.fn(), refetch: vi.fn() }, list: { invalidate: vi.fn() } } }),
    document: { register: { useMutation: () => ({ mutateAsync: registerMutateAsync }) } },
    billingRun: {
      proposal: { useQuery: () => ({ data: proposalData, isLoading: proposalLoading }) },
      createAcconto: {
        useMutation: (opts: { onSuccess: (res: unknown) => Promise<void> }) => {
          accontoOnSuccess = opts.onSuccess;
          return { mutate: accontoMutate, isPending: false, error: null };
        },
      },
      createFinal: {
        useMutation: (opts: { onSuccess: (res: unknown) => Promise<void> }) => {
          finalOnSuccess = opts.onSuccess;
          return { mutate: finalMutate, isPending: false, error: null };
        },
      },
    },
  },
}));
vi.mock("@/lib/client/kostnadsrakning/render-faktura-pdf", () => ({ renderFakturaPdf }));
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const meta = { matterNumber: "2026-0001", matterTitle: "Tvist", clientName: "Anna Andersson" };

beforeEach(() => {
  vi.clearAllMocks();
  accontoOnSuccess = undefined; finalOnSuccess = undefined;
  proposalLoading = false;
  proposalData = {
    workValueOre: 500_000, priorAccontoSumOre: 0,
    timeEntries: [{ id: "te-1", description: "Möte med klient", minutes: 120, hourlyRate: 250_000, billable: true, valueOre: 500_000 }],
    expenses: [{ id: "ex-1", description: "Ansökningsavgift", amount: 90_000, billable: true }],
  };
});

describe("BillingDialog — ACCONTO (#397 avdragsmedvetet förslag)", () => {
  it("förfyller beloppet enligt formeln: 20 % × 5000 kr − 0 = 1000 kr", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("Aconto till klient")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith({
      matterId: "m1", clientShareBips: 2000, amountOre: 100_000, recipient: "KLIENT",
    });
  });

  it("förifyller med ärendets %-sats istället för 20 %: 25 % × 5000 = 1250 kr (#778)", () => {
    const metaWithShare = { ...meta, clientShareBips: 2500 };
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={metaWithShare} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith(expect.objectContaining({ clientShareBips: 2500, amountOre: 125_000 }));
  });

  it("drar av tidigare aconton i förslaget: 20 % × 5000 − 600 = 400 kr", () => {
    proposalData = {
      workValueOre: 500_000, priorAccontoSumOre: 60_000, // 600 kr tidigare
      timeEntries: [], expenses: [],
    };
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith(expect.objectContaining({ amountOre: 40_000 }));
  });

  it("procent → bips + omräknat förslag: 30 % → 3000 bips, 1500 kr", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const [percent] = screen.getAllByRole("textbox"); // [%-andel, belopp]
    fireEvent.change(percent!, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith(expect.objectContaining({ clientShareBips: 3000, amountOre: 150_000 }));
  });

  it("manuell justering av beloppet vinner över förslaget", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("textbox"); // [%-andel, belopp]
    fireEvent.change(boxes[1]!, { target: { value: "750" } }); // belopp-fältet
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    expect(accontoMutate).toHaveBeenCalledWith(expect.objectContaining({ amountOre: 75_000 }));
  });

  it("belopps-fältet är ett text-fält utan spinner-pilar (#778)", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    // Inga number-spinners alls (type=number ger role 'spinbutton').
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(boxes[1]!.getAttribute("inputmode")).toBe("decimal");
  });

  it("tomt belopp när inget förslag finns: rutan är tom från början (#778)", () => {
    proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(boxes[1]!.value).toBe(""); // belopp tomt, inte "0"
  });

  it("visar moms-uppdelning för det inkl-moms-belopp som anges (#778)", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    // Förslag 1000 kr inkl moms → moms 200 kr, exkl 800 kr.
    expect(screen.getByText(/Varav moms \(25 %\):/)).toBeInTheDocument();
    expect(screen.getByText(/exkl\. moms:/)).toBeInTheDocument();
  });

  it("onSuccess genererar ett faktura-dokument", async () => {
    const onClose = vi.fn();
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await accontoOnSuccess!({ invoice: { id: "inv-1", amount: 100_000 } });
    expect(renderFakturaPdf).toHaveBeenCalled();
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: "faktura-inv-1", matterId: "m1", invoiceId: "inv-1", documentType: "Faktura",
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("BillingDialog — FINAL", () => {
  const accontos = [
    { id: "br-1", amountOre: 100_000, recipient: "KLIENT" },
    { id: "br-2", amountOre: 50_000, recipient: "KLIENT" },
  ];

  it("visar de ofakturerade posterna + upparbetat värde", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Poster att fakturera \(2\/2 valda\)/)).toBeInTheDocument();
    expect(screen.getByText("Möte med klient")).toBeInTheDocument();
    expect(screen.getByText("Ansökningsavgift")).toBeInTheDocument();
    expect(screen.getByText("Valt värde")).toBeInTheDocument();
  });

  it("visar tomtext när inga ofakturerade poster finns", () => {
    proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Inga ofakturerade poster/)).toBeInTheDocument();
  });

  it("default: alla aconton förvalda, submit drar av dem alla", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={accontos} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith({
      matterId: "m1", recipient: "KLIENT", deductedBillingRunIds: ["br-1", "br-2"],
    });
  });

  it("avmarkera ett aconto → utesluts ur avdragen", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={accontos} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox"); // [post te-1, post ex-1, aconto br-1, aconto br-2]
    fireEvent.click(boxes[2]!); // avmarkera br-1 (första aconto efter de 2 posterna)
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith(expect.objectContaining({ deductedBillingRunIds: ["br-2"] }));
  });

  it("per-post-val: avmarkera en post → bara valda id:n i payloaden (#734)", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox"); // [post te-1, post ex-1]
    fireEvent.click(boxes[1]!); // avmarkera utlägget ex-1
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith(expect.objectContaining({ timeEntryIds: ["te-1"], expenseIds: [] }));
  });

  it("default (inga poster avmarkerade) → inga post-id:n i payloaden (allt faktureras)", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    const call = finalMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.timeEntryIds).toBeUndefined();
    expect(call.expenseIds).toBeUndefined();
  });

  it("byt mottagare → skickas i payloaden", () => {
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "FORSAKRING" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(finalMutate).toHaveBeenCalledWith(expect.objectContaining({ recipient: "FORSAKRING" }));
  });

  it("onSuccess genererar ett faktura-dokument", async () => {
    const onClose = vi.fn();
    render(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await finalOnSuccess!({ invoice: { id: "inv-7", amount: 590_000 } });
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: "faktura-inv-7", invoiceId: "inv-7" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
