/**
 * Tester för BillingDialog (#27/#397) — ACCONTO- + FINAL-flödena:
 * avdragsmedvetet aconto-förslag (%-sats × upparbetat − tidigare aconton),
 * ofakturerade-poster-listan i FINAL, procent↔bips, mottagar-val, acconto-
 * avdrag och faktura-dokument-generering på onSuccess.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingDialog } from "@/app/matters/[id]/_billing-dialog";
import { toIsoDate } from "@/lib/shared/iso-date";
import { asId } from "@/lib/shared/schemas/ids";
import { pdfPageTexts } from "../../../helpers/pdf-text";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type FakeTrpcLink } from "../../../helpers/trpc-fake";

/** Fakturadokumentet får uuid-id (#1143). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const persistGeneratedDoc = vi.fn(async (_doc: { bytes: Uint8Array }) => {});
/** Hur createAcconto/createFinal svarar; standard är ett anrop som aldrig blir klart. */
let mutationAnswer: () => unknown = () => new Promise(() => {});
let current: FakeTrpcLink | undefined;

let proposalData: unknown = {
  workValueOre: 500_000, // 5000 kr upparbetat
  priorAccontoSumOre: 0,
  timeEntries: [{ id: "te-1", description: "Möte med klient", minutes: 120, hourlyRate: 250_000, billable: true, valueOre: 500_000, date: new Date("2026-03-02T09:00:00Z") }],
  expenses: [{ id: "ex-1", description: "Ansökningsavgift", amount: 90_000, billable: true, date: "2026-03-10" }],
};
let proposalLoading = false;

const SPEC = {
  timeLines: [], expenseLines: [], totalMinutes: 0, arvodeNetOre: 0, arvodeVatOre: 0,
  expensesNetOre: 0, expensesVatOre: 0, grossOre: 0, deductions: [], deductionOre: 0, adjustmentOre: 0, payableOre: 0,
};

/** Renderar dialogen mot en fejkad tRPC-länk och väntar tills förslaget har hämtats. */
async function renderDialog(ui: ReactElement): Promise<void> {
  const fake = fakeTrpcLink({
    ...(proposalData === undefined ? {} : { "billingRun.proposal": () => (proposalLoading ? new Promise(() => {}) : proposalData) }),
    "billingRun.createAcconto": () => mutationAnswer(),
    "billingRun.createFinal": () => mutationAnswer(),
    "billingRun.invoiceSpecification": () => SPEC,
    "document.register": () => ({}),
  });
  current = fake;
  const queryClient = testQueryClient();
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}>{ui}</TrpcTestProvider>);
  if (proposalLoading) return;
  await waitFor(() => expect(queryClient.getQueryCache().getAll().every((q) => q.state.status !== "pending")).toBe(true));
}

/** Indata i det senaste anropet till `path`. */
function lastInput(path: string): unknown {
  return current?.calls.filter((c) => c.path === path).at(-1)?.input;
}

/** Väntar tills `path` anropats med indata som stämmer. */
async function expectCalled(path: string, input: unknown): Promise<void> {
  await waitFor(() => expect(lastInput(path)).toEqual(input));
}

/** Skicka formuläret när mutationen svarar `res`, och vänta tills dialogen stängts. */
async function submitWith(button: string, res: unknown, onClose: () => void): Promise<void> {
  mutationAnswer = () => res;
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
}

/** Texten i det första genererade fakturadokumentet. */
async function docText(): Promise<string> {
  const arg = persistGeneratedDoc.mock.calls[0]?.[0];
  if (!arg) throw new Error("inget dokument genererades");
  return (await pdfPageTexts(arg.bytes)).flat().join("\n");
}

/** En sparad acontonedbrytning (#1940): uträkningen som fakturan bär. */
const BREAKDOWN = {
  rows: [
    { label: "Upparbetat", amountOre: 500_000, kind: "info" },
    { label: "Klientens andel av upparbetat", amountOre: 100_000, kind: "add" },
  ],
  totalLabel: "Att betala nu", totalOre: 100_000,
};

vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const meta = { matterNumber: "2026-0001", matterTitle: "Tvist", clientName: "Anna Andersson", organizationName: "Byrå AB" };

beforeEach(() => {
  vi.clearAllMocks();
  mutationAnswer = () => new Promise(() => {});
  current = undefined;
  proposalLoading = false;
  proposalData = {
    workValueOre: 500_000, priorAccontoSumOre: 0,
    timeEntries: [{ id: "te-1", description: "Möte med klient", minutes: 120, hourlyRate: 250_000, billable: true, valueOre: 500_000, date: new Date("2026-03-02T09:00:00Z") }],
    expenses: [{ id: "ex-1", description: "Ansökningsavgift", amount: 90_000, billable: true, date: "2026-03-10" }],
  };
});

describe("BillingDialog — ACCONTO (#397 avdragsmedvetet förslag)", () => {
  it("förfyller beloppet enligt formeln inkl. moms: 20 % × 5000 kr + moms − 0 = 1250 kr (#1726)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("Aconto till klient")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", {
      matterId: "m1", clientShareBips: 2000, amountOre: 125_000, recipient: "KLIENT", invoiceDate: toIsoDate(new Date()),
    });
  });

  it("rutan visar allt inkl. moms: upparbetat + moms, tidigare aconton och förslaget (#1726)", async () => {
    proposalData = { workValueOre: 500_000, priorAccontoSumOre: 60_000, timeEntries: [], expenses: [] };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const stat = (label: string): string => screen.getByText(label).nextElementSibling?.textContent ?? "";
    expect(stat("Upparbetat")).toMatch(/6\s?250,00/); // 5000 kr + 25 % moms
    expect(stat("Tidigare aconton")).toMatch(/600,00/);
    expect(stat("Förslag")).toMatch(/650,00/); // 1250 − 600
    expect(screen.getByText("Belopp inkl. moms")).toBeInTheDocument();
    expect(screen.queryByText("Belopp exkl. moms")).toBeNull();
    expect(screen.getAllByRole<HTMLInputElement>("textbox")[1]?.value).toBe("650");
  });

  it("fakturadatum går att ändra och skickas med (#1173)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Fakturadatum"), { target: { value: "2030-06-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ invoiceDate: "2030-06-15" }));
  });

  it("förifyller med ärendets %-sats istället för 20 %: 25 % × 5000 + moms = 1563 kr (#778, #1726)", async () => {
    const metaWithShare = { ...meta, clientShareBips: 2500 };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={metaWithShare} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ clientShareBips: 2500, amountOre: 156_300 }));
  });

  it("drar av tidigare aconton i förslaget: 20 % × 5000 + moms − 600 = 650 kr (#1726)", async () => {
    proposalData = {
      workValueOre: 500_000, priorAccontoSumOre: 60_000, // 600 kr tidigare
      timeEntries: [], expenses: [],
    };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ amountOre: 65_000 }));
  });

  it("procent → bips + omräknat förslag: 30 % → 3000 bips, 1875 kr inkl. moms", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const [percent] = screen.getAllByRole("textbox"); // [%-andel, belopp]
    fireEvent.change(percent!, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ clientShareBips: 3000, amountOre: 187_500 }));
  });

  it("manuell justering av beloppet vinner över förslaget", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("textbox"); // [%-andel, belopp]
    fireEvent.change(boxes[1]!, { target: { value: "750" } }); // belopp-fältet
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ amountOre: 75_000 }));
  });

  it("ett belopp med ören avrundas synligt till hela kronor — det som visas faktureras (#1438)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull(); // förslaget är redan hela kronor
    const boxes = screen.getAllByRole("textbox");
    fireEvent.change(boxes[1]!, { target: { value: "750,50" } });
    expect(screen.getByRole("status").textContent).toMatch(/Avrundat till hela kronor:\s*751,00/);
    fireEvent.click(screen.getByRole("button", { name: "Skapa aconto-faktura" }));
    await expectCalled("billingRun.createAcconto", expect.objectContaining({ amountOre: 75_100 }));
  });

  it("belopps-fältet är ett text-fält utan spinner-pilar (#778)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    // Inga number-spinners alls (type=number ger role 'spinbutton').
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    const boxes = screen.getAllByRole<HTMLInputElement>("textbox");
    expect(boxes[1]!.getAttribute("inputmode")).toBe("decimal");
  });

  it("tomt belopp när inget förslag finns: rutan är tom från början (#778)", async () => {
    proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole<HTMLInputElement>("textbox");
    expect(boxes[1]!.value).toBe(""); // belopp tomt, inte "0"
  });

  it("visar moms-uppdelning för det inkl-moms-belopp som anges (#778)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    // Förslag 1250 kr inkl moms → moms 250 kr, exkl 1000 kr.
    expect(screen.getByText(/Varav moms \(25 %\):/)).toBeInTheDocument();
    expect(screen.getByText(/exkl\. moms:/)).toBeInTheDocument();
  });

  it("onSuccess genererar ett faktura-dokument", async () => {
    const onClose = vi.fn();
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await submitWith("Skapa aconto-faktura", { invoice: { id: "inv-1", amount: 100_000, invoiceType: "ACCONTO", notes: "Aconto — klientens andel" } }, onClose);
    expect(lastInput("billingRun.invoiceSpecification")).toEqual({ matterId: "m1", invoiceId: "inv-1" });
    // Aconton renderas via den DELADE vy-modellen (#937) som PDF (#1439):
    // sammanställning med notes-raden (fakturan har inga länkade tidsposter).
    const text = (await docText()).split("\n");
    expect(text).toContain("ACONTO-FAKTURA");
    expect(text).toContain("Sammanställning");
    expect(text).toContain("Aconto - klientens andel"); // WinAnsi: tankstreck → bindestreck
    expect(text).toContain("Mottagare: Anna Andersson"); // mottagare = klienten
    // Byråns fält ur metan (#1439) står i sidhuvudet.
    expect(text).toContain("Byrå AB");
    expect(lastInput("document.register")).toEqual(expect.objectContaining({
      id: expect.stringMatching(UUID_RE), matterId: "m1", invoiceId: "inv-1", kinds: ["FAKTURA"],
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
  });

  it("dokumentet får fakturans sparade nedbrytning, som på fakturasidan (#1941)", async () => {
    const onClose = vi.fn();
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await submitWith("Skapa aconto-faktura", { invoice: { id: "inv-2", amount: 100_000, invoiceType: "ACCONTO", settlementBreakdown: BREAKDOWN } }, onClose);
    const text = await docText();
    expect(text).toContain("Klientens andel av upparbetat");
    expect(text).toContain("Att betala nu");
  });

  it("dokumentet läser acontots egen kolumn före settlementBreakdown (#2180)", async () => {
    const onClose = vi.fn();
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={onClose} />);
    const stale = { ...BREAKDOWN, rows: [], totalLabel: "Gammal summa" };
    await submitWith("Skapa aconto-faktura", { invoice: { id: "inv-3", amount: 100_000, invoiceType: "ACCONTO", accontoBreakdown: BREAKDOWN, settlementBreakdown: stale } }, onClose);
    const text = await docText();
    expect(text).toContain("Att betala nu");
    expect(text).not.toContain("Gammal summa");
  });

  it("hjälptexten säger att beloppet bara ändras i undantagsfall (#1941)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="ACCONTO" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Ändra bara beloppet i undantagsfall\. Skillnaden visas som Justering på fakturan\./)).toBeInTheDocument();
    expect(screen.queryByText(/för att runda av/)).not.toBeInTheDocument();
  });
});

describe("BillingDialog — FINAL", () => {
  const accontos = [
    { id: "br-1", amountOre: 100_000, recipient: "KLIENT" },
    { id: "br-2", amountOre: 50_000, recipient: "KLIENT" },
  ];

  it("visar de ofakturerade posterna + upparbetat värde", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Poster att fakturera \(2\/2 valda\)/)).toBeInTheDocument();
    expect(screen.getByText("Möte med klient")).toBeInTheDocument();
    expect(screen.getByText("Ansökningsavgift")).toBeInTheDocument();
    expect(screen.getByText("Valt värde")).toBeInTheDocument();
  });

  it("visar tomtext när inga ofakturerade poster finns", async () => {
    proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Inga ofakturerade poster/)).toBeInTheDocument();
  });

  it("default: alla aconton förvalda, submit drar av dem alla", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={accontos} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("Faktura")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", {
      matterId: "m1", recipient: "KLIENT", deductedBillingRunIds: ["br-1", "br-2"], invoiceDate: toIsoDate(new Date()),
    });
  });

  it("slutfaktura: valt fakturadatum skickas med (#1173)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={accontos} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Fakturadatum"), { target: { value: "2030-06-16" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ invoiceDate: "2030-06-16" }));
  });

  it("avmarkera ett aconto → utesluts ur avdragen", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={accontos} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox"); // [post te-1, post ex-1, aconto br-1, aconto br-2]
    fireEvent.click(boxes[2]!); // avmarkera br-1 (första aconto efter de 2 posterna)
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ deductedBillingRunIds: ["br-2"] }));
  });

  it("per-post-val: avmarkera en post → bara valda id:n i payloaden (#734)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    const boxes = screen.getAllByRole("checkbox"); // [post te-1, post ex-1]
    fireEvent.click(boxes[1]!); // avmarkera utlägget ex-1
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ timeEntryIds: ["te-1"], expenseIds: [] }));
  });

  it("default (inga poster avmarkerade) → inga post-id:n i payloaden (allt faktureras)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ matterId: "m1" }));
    expect(lastInput("billingRun.createFinal")).not.toHaveProperty("timeEntryIds");
    expect(lastInput("billingRun.createFinal")).not.toHaveProperty("expenseIds");
  });

  it("varje post visar sitt datum som svensk kalenderdag (#1888)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("2026-03-02")).toBeInTheDocument();
    expect(screen.getByText("2026-03-10")).toBeInTheDocument();
  });

  it("datumintervallet markerar posterna inom det och avmarkerar övriga (#1888)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Från och med"), { target: { value: "2026-03-05" } });
    expect(screen.getByText(/Poster att fakturera \(1\/2 valda\)/)).toBeInTheDocument();
    expect(screen.getByText("Valt värde").nextElementSibling?.textContent).toMatch(/900,00/);
    fireEvent.change(screen.getByLabelText("Till och med"), { target: { value: "2026-03-05" } });
    expect(screen.getByText(/Poster att fakturera \(0\/2 valda\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Från och med"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ timeEntryIds: ["te-1"], expenseIds: [] }));
  });

  it("ett kryss efter intervallet står kvar (#1888)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Från och med"), { target: { value: "2026-03-05" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Möte med klient/ })); // tidsposten utanför intervallet
    expect(screen.getByText(/Poster att fakturera \(2\/2 valda\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ timeEntryIds: ["te-1"], expenseIds: ["ex-1"] }));
  });

  it("två tömda datumfält markerar allt och skickar inga id:n (#1888)", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Till och med"), { target: { value: "2026-03-05" } });
    fireEvent.change(screen.getByLabelText("Till och med"), { target: { value: "" } });
    expect(screen.getByText(/Poster att fakturera \(2\/2 valda\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.not.objectContaining({ timeEntryIds: expect.anything() }));
  });

  it("utan beskrivning heter raderna Tidspost och Utlägg", async () => {
    proposalData = {
      workValueOre: 0, priorAccontoSumOre: 0,
      timeEntries: [{ id: "t", description: "", minutes: 1, hourlyRate: 1, billable: true, valueOre: 1, date: "2026-01-01" },
        { id: "n", description: "Ej debiterbar", minutes: 1, hourlyRate: 1, billable: false, valueOre: 1, date: "2026-01-01" }],
      expenses: [{ id: "e", description: "", amount: 1, billable: true, date: "2026-01-01" }],
    };
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText("Tidspost")).toBeInTheDocument();
    expect(screen.getByText("Utlägg")).toBeInTheDocument();
    expect(screen.queryByText("Ej debiterbar")).toBeNull();
  });

  it("utan förslag (ingen data) visas tomtexten", async () => {
    proposalData = undefined;
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Inga ofakturerade poster/)).toBeInTheDocument();
  });

  it("visar laddningstext medan förslaget hämtas", async () => {
    proposalLoading = true;
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    expect(screen.getByText(/Laddar ofakturerade poster/)).toBeInTheDocument();
  });

  it("byt mottagare → skickas i payloaden", async () => {
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "FORSAKRING" } });
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    await expectCalled("billingRun.createFinal", expect.objectContaining({ recipient: "FORSAKRING" }));
  });

  it("onSuccess genererar ett faktura-dokument", async () => {
    const onClose = vi.fn();
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await submitWith("Skapa faktura", { invoice: { id: "inv-7", amount: 590_000 } }, onClose);
    expect(lastInput("document.register")).toEqual(expect.objectContaining({ id: expect.stringMatching(UUID_RE), invoiceId: "inv-7" }));
  });

  it("utan sparad nedbrytning blir dokumentet som förut (#1941)", async () => {
    const onClose = vi.fn();
    await renderDialog(<BillingDialog matterId={asId<"MatterId">("m1")} type="FINAL" existingAccontos={[]} meta={meta} onClose={onClose} />);
    await submitWith("Skapa faktura", { invoice: { id: "inv-8", amount: 590_000 } }, onClose);
    const text = await docText();
    expect(text).not.toContain("Klientens andel av upparbetat");
    expect(text).not.toContain("Att betala nu");
  });
});
