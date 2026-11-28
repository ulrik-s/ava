/**
 * Test för ExpenseSection — utläggslistan i ett ärende: rendering av rader +
 * moms-uppdelning, summa-footer, lås av fakturerade utlägg, ta-bort-flödet
 * och "Nytt utlägg"-modalen.
 */

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest-compat";
import { ExpenseSection } from "@/app/matters/[id]/_expense-section";
import { expenseBreakdownLines, grossOreOf, netOreOf, vatOreOf } from "@/lib/shared/billing/billing-work-value";
import { asId } from "@/lib/shared/schemas/ids";
import { callsTo, renderWithFakeTrpc, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type TrpcHandlers } from "../../../helpers/trpc-fake";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const defaultData: unknown = {
    expenses: [
      { id: "e1", date: "2026-03-01", amount: 12500, description: "Tågbiljett", billable: true, user: { name: "Anna" }, vatRate: 2500, vatIncluded: true, invoiceId: null },
      { id: "e2", date: "2026-03-02", amount: 50000, description: "Domstolsavgift", billable: true, user: { name: "Anna" }, vatRate: 2500, vatIncluded: true, invoiceId: "inv9", invoice: { id: "inv9", invoiceNumber: "F-2026-0001" } },
    ],
    totalAmount: 62500,
};
let expenseData: unknown = defaultData;

const handlers: TrpcHandlers = {
  "expense.list": () => expenseData,
  "expense.create": () => ({ id: "e-ny" }),
  "expense.update": () => ({ id: "e1" }),
  "expense.delete": () => ({ id: "e1" }),
  "prefs.get": () => null,
  "user.current": () => ({ id: "u1", role: "LAWYER" }),
};

beforeEach(() => {
  expenseData = defaultData;
});

afterEach(() => { vi.restoreAllMocks(); });

/** Renderar sektionen och väntar tills raden `firstRow` syns. */
async function renderSection(firstRow = "Tågbiljett"): Promise<FakeTrpcRender> {
  const view = renderWithFakeTrpc(<ExpenseSection matterId={asId<"MatterId">("m1")} />, handlers);
  await screen.findByText(firstRow);
  return view;
}

describe("ExpenseSection", () => {
  it("renderar rubrik med total och utläggsraderna", async () => {
    await renderSection();
    expect(screen.getByText("Utlägg")).toBeInTheDocument();
    expect(screen.getByText(/totalt/)).toBeInTheDocument();
    expect(screen.getByText("Tågbiljett")).toBeInTheDocument();
    expect(screen.getByText("Domstolsavgift")).toBeInTheDocument();
  });

  it("visar summa-footer", async () => {
    await renderSection();
    expect(screen.getByText("Summa")).toBeInTheDocument();
  });

  it("låser fakturerade utlägg (ingen ändra/ta-bort) men tillåter åtgärder på ej fakturerade", async () => {
    await renderSection();
    expect(screen.getByText("Låst (på faktura)")).toBeInTheDocument();
    // Endast det ofakturerade utlägget (e1) har Ändra/Ta bort.
    expect(screen.getByText("Ändra")).toBeInTheDocument();
    expect(screen.getByText("Ta bort")).toBeInTheDocument();
  });

  it("Ta bort med confirm → delete.mutate med utläggets id", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = await renderSection();
    fireEvent.click(screen.getByText("Ta bort"));
    await waitFor(() => expect(callsTo(view.fake, "expense.delete")).toEqual([{ id: "e1" }]));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("'+ Nytt utlägg' öppnar skapa-modalen", async () => {
    await renderSection();
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    expect(screen.getByText("Nytt utlägg")).toBeInTheDocument();
    expect(screen.getByText("Debiterbar")).toBeInTheDocument();
  });

  it("fyller i skapa-formuläret + Spara → create.mutate med matterId + payload", async () => {
    const view = await renderSection();
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-03-15" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "150" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Parkering" } });
    // VatPreview visar vad KLIENTEN debiteras (#975), inte vad byrån betalade.
    expect(screen.getByText(/Debiteras:.*moms 25 %:.*inkl:/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Spara"));
    // Inmatat exkl. 150 kr → lagras NETTO 150 kr, vatIncluded=false (#782).
    // passThrough=false: utlägget är ett kostnadselement tills motsatsen sägs (#975).
    await waitFor(() => expect(callsTo(view.fake, "expense.create")).toEqual([
      expect.objectContaining({ matterId: "m1", description: "Parkering", amount: 15000, vatRate: 2500, vatIncluded: false, passThrough: false }),
    ]));
  });

  it("byter momssats-select + Debiterbar utan att krascha (ingen incl/excl-toggel längre)", async () => {
    await renderSection();
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    // Incl/excl-radions är borttagen — inmatning är alltid exkl. moms (#781).
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1200" } });
    // Två kryssrutor sedan #975: "Äkta utlägg" och "Debiterbar".
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]!); // Debiterbar av
    expect(screen.getByText("Spara")).toBeInTheDocument();
  });

  it("'Äkta utlägg' → passThrough=true och momsen faller bort (#975)", async () => {
    const view = await renderSection();
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "900" } });
    fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Ansökningsavgift" } });
    // Default: kostnadselement → 25 % läggs på.
    expect(screen.getByText(/moms 25 %/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!); // Äkta utlägg på
    expect(screen.getByText(/moms 0 %/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Spara"));
    await waitFor(() => expect(callsTo(view.fake, "expense.create")).toEqual([expect.objectContaining({ passThrough: true })]));
  });

  it("'Ändra' öppnar förifyllt edit-formulär → Spara ändring → update.mutate med id", async () => {
    const view = await renderSection();
    fireEvent.click(screen.getByText("Ändra"));
    expect(screen.getByText("Ändra utlägg")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Tågbiljett")).toBeInTheDocument(); // förifyllt ur e1
    fireEvent.click(screen.getByText("Spara ändring"));
    await waitFor(() => expect(callsTo(view.fake, "expense.update")).toEqual([expect.objectContaining({ id: "e1" })]));
  });

  it("Avbryt stänger skapa-modalen", async () => {
    await renderSection();
    fireEvent.click(screen.getByText("+ Nytt utlägg"));
    fireEvent.click(screen.getByText("Avbryt"));
    expect(screen.queryByText("Nytt utlägg")).not.toBeInTheDocument();
  });
});

/*
 * #1826: listan räknar som fakturan — varje rad i hela kronor och 25 % moms på
 * summan av raderna (`chargedExpenseLines`). Öresavrundningen gav 615,03 /
 * 131,26 / 746,29 kr, som inte gick ihop med fakturans utläggsrader.
 */
describe("ExpenseSection — summorna som på fakturan (#1826)", () => {
  const expenses = [
    { id: asId<"ExpenseId">("x1"), date: "2026-03-01", amount: 10050, description: "Porto", billable: true, vatRate: 2500, vatIncluded: false, passThrough: false, invoiceId: null },
    { id: asId<"ExpenseId">("x2"), date: "2026-03-02", amount: 45000, description: "Tåg", billable: true, vatRate: 600, passThrough: false, invoiceId: null },
    { id: asId<"ExpenseId">("x3"), date: "2026-03-03", amount: 9000, description: "Ansökningsavgift", billable: true, vatRate: 2500, vatIncluded: false, passThrough: true, invoiceId: null },
  ];

  beforeEach(() => { expenseData = { expenses, totalAmount: 64050 }; });

  const rowOf = (text: string): HTMLElement => {
    const row = screen.getByText(text).closest("tr");
    if (!row) throw new Error(`ingen rad för ${text}`);
    return row;
  };

  it("summaraden är fakturans utläggsrader: 641,00 / 138,00 / 779,00 kr", async () => {
    await renderSection("Porto");
    const footer = within(rowOf("Summa"));
    const lines = expenseBreakdownLines({ timeEntries: [], expenses });
    expect([netOreOf(lines), vatOreOf(lines), grossOreOf(lines)]).toEqual([64_100, 13_800, 77_900]);
    expect(footer.getByText(/641,00/)).toBeInTheDocument();
    expect(footer.getByText(/138,00/)).toBeInTheDocument();
    expect(footer.getByText(/779,00/)).toBeInTheDocument();
  });

  it("varje rad i hela kronor: 100,50 kr blir 101,00 / 25,00 / 126,00 kr", async () => {
    await renderSection("Porto");
    const row = within(rowOf("Porto"));
    expect(row.getByText(/101,00/)).toBeInTheDocument();
    expect(row.getByText(/25,00/)).toBeInTheDocument();
    expect(row.getByText(/126,00/)).toBeInTheDocument();
  });

  it("ett utlägg utan vatIncluded är netto, och ett äkta utlägg bär ingen moms", async () => {
    await renderSection("Porto");
    expect(within(rowOf("Tåg")).getByText(/450,00/)).toBeInTheDocument();
    expect(within(rowOf("Ansökningsavgift")).getByText(/^0,00/)).toBeInTheDocument();
    expect(within(rowOf("Ansökningsavgift")).getAllByText(/90,00/)).toHaveLength(2);
  });

  it("Ändra fyller i nettot ur expenseNetOre (utan vatIncluded: netto)", async () => {
    await renderSection("Porto");
    fireEvent.click(within(rowOf("Tåg")).getByText("Ändra"));
    expect(screen.getByDisplayValue("450")).toBeInTheDocument();
  });
});

describe("ExpenseSection — fakturaförslaget hämtas om (#2201)", () => {
  const EXPECTED = ['billingRun.proposal {"matterId":"m1"}', 'expense.list {"matterId":"m1"}'];
  const actions: Record<"create" | "update" | "delete", () => void> = {
    create: () => {
      fireEvent.click(screen.getByText("+ Nytt utlägg"));
      fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "150" } });
      fireEvent.change(screen.getByPlaceholderText("Beskrivning *"), { target: { value: "Parkering" } });
      fireEvent.click(screen.getByText("Spara"));
    },
    update: () => {
      fireEvent.click(screen.getByText("Ändra"));
      fireEvent.click(screen.getByText("Spara ändring"));
    },
    delete: () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fireEvent.click(screen.getByText("Ta bort"));
    },
  };

  for (const name of ["create", "update", "delete"] as const) {
    it(`${name}: listan och ärendets förslag hämtas om när ändringen lyckats`, async () => {
      const view = await renderSection();
      expect(view.invalidate).not.toHaveBeenCalled();
      actions[name]();
      await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(EXPECTED));
      expect(callsTo(view.fake, `expense.${name}`)).toHaveLength(1);
    });
  }

  it("en misslyckad ändring hämtar inget om", async () => {
    const failing = renderWithFakeTrpc(<ExpenseSection matterId={asId<"MatterId">("m1")} />, { ...handlers, "expense.delete": () => { throw new Error("nej"); } });
    await screen.findByText("Tågbiljett");
    actions.delete();
    await waitFor(() => expect(callsTo(failing.fake, "expense.delete")).toHaveLength(1));
    expect(failing.invalidate).not.toHaveBeenCalled();
  });
});
