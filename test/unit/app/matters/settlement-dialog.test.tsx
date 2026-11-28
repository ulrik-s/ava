/**
 * SettlementDialog (#852/#1439) — slutregleringen skapar fakturadokument för
 * betalarens och klientens faktura. Båda får ärendets och byråns fält (namn,
 * org.nr och logga ur organisationsinställningarna).
 *
 * Förhandsvisningen (#1438) visar klientens och betalarens del med samma netto
 * och brutto som fakturorna får — betalaren är totalen minus klientens del.
 */

import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { SettlementDialog } from "@/app/matters/[id]/_settlement-dialog";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../../helpers/trpc-fake";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let matterData: unknown;
let orgData: unknown;
let splitData: Record<string, number> | null;
type GenArgs = { recipient: string; meta: unknown; breakdown?: unknown };
const generateFn = vi.fn(async (_args: GenArgs) => "generated" as const);

vi.mock("@/lib/client/kostnadsrakning/generate-faktura-doc", () => ({
  generateFakturaFromTemplate: (args: GenArgs) => generateFn(args),
}));

const BREAKDOWN = { rows: [], totalLabel: "Att betala (inkl moms)", totalOre: 100_000, timeLines: [] };
const RES = { payerInvoice: { id: "inv-p", amount: 100_000, settlementBreakdown: BREAKDOWN }, clientInvoice: { id: "inv-c", amount: 20_000 } };

/** Svaren; ett ärende eller inställningar som saknas (`undefined`) ger ett fel → ingen data. */
function handlers(): TrpcHandlers {
  return {
    "billingRun.coverageSplit": () => splitData,
    "billingRun.settleCoverage": () => RES,
    ...(matterData === undefined ? {} : { "matter.getById": () => matterData }),
    ...(orgData === undefined ? {} : { "organization.getSettings": () => orgData }),
  };
}

/** Väntar tills alla frågor har svarat (eller fallerat). */
async function settled(queryClient: QueryClient): Promise<void> {
  await waitFor(() => expect(queryClient.getQueryCache().getAll().every((q) => q.state.status !== "pending")).toBe(true));
}

async function renderDialog(paymentMethod: PaymentMethod, onClose: () => void = vi.fn()) {
  const fake = fakeTrpcLink(handlers());
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}><SettlementDialog matterId={asId<"MatterId">("m1")} paymentMethod={paymentMethod} onClose={onClose} /></TrpcTestProvider>);
  await settled(queryClient);
  return { fake, invalidate };
}

/** Skapa fakturorna och vänta tills dialogen stängts. */
async function settle(onClose: () => void): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Skapa fakturor" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  matterData = { matterNumber: "2026-0010", title: "Umgängestvist", contacts: [{ role: "KLIENT", contact: { name: "Cecilia Carlsson" } }] };
  orgData = { name: "Byrå AB", orgNumber: "556677-8899", logo: LOGO };
  splitData = null;
});

describe("SettlementDialog — fakturadokumenten", () => {
  it("båda fakturorna får ärendets fält och byråns namn, org.nr och logga (#1439)", async () => {
    const onClose = vi.fn();
    const { fake, invalidate } = await renderDialog("RATTSHJALP", onClose);
    await settle(onClose);
    expect(fake.calls.find((c) => c.path === "billingRun.settleCoverage")?.input).toEqual({ matterId: "m1", payerRecipient: "DOMSTOL" });
    expect(generateFn).toHaveBeenCalledTimes(2);
    const meta = { matterNumber: "2026-0010", matterTitle: "Umgängestvist", organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: LOGO };
    expect(generateFn.mock.calls.map(([a]: [GenArgs]) => [a.recipient, a.meta])).toEqual([
      ["Domstolen betalar", meta],
      ["Cecilia Carlsson", meta],
    ]);
    // Betalarens persisterade nedbrytning (#876) blir dokumentets uppdelning.
    expect(generateFn.mock.calls[0]?.[0]).toMatchObject({ breakdown: BREAKDOWN });
    // Efter slutregleringen hämtas ärendets körningar och fakturalistan om.
    await waitFor(() => expect(invalidatedPaths(invalidate)).toEqual(["billingRun.list {\"matterId\":\"m1\"}", "invoice.list"]));
  });

  it("utan ärende och inställningar blir fälten tomma — dokumenten skapas ändå", async () => {
    matterData = undefined;
    orgData = undefined;
    const onClose = vi.fn();
    await renderDialog("RATTSSKYDD", onClose);
    await settle(onClose);
    expect(generateFn.mock.calls.map(([a]: [GenArgs]) => [a.recipient, a.meta])).toEqual([
      ["Försäkringen betalar", { matterNumber: "", matterTitle: "" }],
      ["Klient", { matterNumber: "", matterTitle: "" }],
    ]);
  });
});

const SPLIT = {
  totalOre: 325_200, expensesNetOre: 10_000, expensesGrossOre: 12_500,
  clientOre: 67_000, clientGrossOre: 83_800,
  payerOre: 268_200, payerGrossOre: 335_200,
  firmLossOre: 20_000, firmLossGrossOre: 25_000,
};

const amountOf = (label: string): string => screen.getByText(label).parentElement?.querySelector("button")?.textContent?.replace(/\s/g, "") ?? "";

describe("SettlementDialog — förhandsvisning (#1438)", () => {
  it("visar klientens, betalarens och byråns del med fakturornas netto och brutto", async () => {
    splitData = SPLIT;
    const { fake } = await renderDialog("RATTSHJALP");
    expect(fake.calls.find((c) => c.path === "billingRun.coverageSplit")?.input).toEqual({ matterId: "m1" });
    // Momsväxlingen styr om netto eller brutto visas — båda kommer ur samma fördelning.
    const shown = [amountOf("Klientens del"), amountOf("Domstolen betalar"), amountOf("Byrån bär (prutning)")];
    expect([["838,00kr", "3352,00kr", "250,00kr"], ["670,00kr", "2682,00kr", "200,00kr"]]).toContainEqual(shown);
  });

  it("utan nedsättning visas ingen förlustrad", async () => {
    splitData = { ...SPLIT, firmLossOre: 0, firmLossGrossOre: 0 };
    await renderDialog("RATTSSKYDD");
    expect(screen.queryByText("Byrån bär (prutning)")).toBeNull();
    expect(screen.getByText("Försäkringen betalar")).toBeTruthy();
  });
});
