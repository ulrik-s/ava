/**
 * SettlementDialog (#852/#1439) — slutregleringen skapar fakturadokument för
 * betalarens och klientens faktura. Båda får ärendets och byråns fält (namn,
 * org.nr och logga ur organisationsinställningarna).
 *
 * Förhandsvisningen (#1438) visar klientens och betalarens del med samma netto
 * och brutto som fakturorna får — betalaren är totalen minus klientens del.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { SettlementDialog } from "@/app/matters/[id]/_settlement-dialog";
import { asId } from "@/lib/shared/schemas/ids";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let settleOnSuccess: ((res: unknown) => Promise<void>) | undefined;
let matterData: unknown;
let orgData: unknown;
let splitData: Record<string, number> | undefined;
type GenArgs = { recipient: string; meta: unknown; breakdown?: unknown };
const generateFn = vi.fn(async (_args: GenArgs) => "generated" as const);
const invalidate = vi.fn(async () => {});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ billingRun: { list: { invalidate } }, invoice: { list: { invalidate } } }),
    billingRun: {
      coverageSplit: { useQuery: () => ({ data: splitData }) },
      settleCoverage: {
        useMutation: (opts: { onSuccess: (res: unknown) => Promise<void> }) => {
          settleOnSuccess = opts.onSuccess;
          return { mutate: vi.fn(), isPending: false, error: null };
        },
      },
    },
    matter: { getById: { useQuery: () => ({ data: matterData }) } },
    organization: { getSettings: { useQuery: () => ({ data: orgData }) } },
    document: { register: { useMutation: () => ({ mutateAsync: vi.fn(async () => {}) }) } },
  },
}));
vi.mock("@/lib/client/kostnadsrakning/generate-faktura-doc", () => ({
  generateFakturaFromTemplate: (args: GenArgs) => generateFn(args),
}));

const BREAKDOWN = { rows: [], totalLabel: "Att betala (inkl moms)", totalOre: 100_000, timeLines: [] };
const RES = { payerInvoice: { id: "inv-p", amount: 100_000, settlementBreakdown: BREAKDOWN }, clientInvoice: { id: "inv-c", amount: 20_000 } };

beforeEach(() => {
  vi.clearAllMocks();
  settleOnSuccess = undefined;
  matterData = { matterNumber: "2026-0010", title: "Umgängestvist", contacts: [{ role: "KLIENT", contact: { name: "Cecilia Carlsson" } }] };
  orgData = { name: "Byrå AB", orgNumber: "556677-8899", logo: LOGO };
  splitData = undefined;
});

describe("SettlementDialog — fakturadokumenten", () => {
  it("båda fakturorna får ärendets fält och byråns namn, org.nr och logga (#1439)", async () => {
    const onClose = vi.fn();
    render(<SettlementDialog matterId={asId<"MatterId">("m1")} paymentMethod="RATTSHJALP" onClose={onClose} />);
    await settleOnSuccess?.(RES);
    expect(generateFn).toHaveBeenCalledTimes(2);
    const meta = { matterNumber: "2026-0010", matterTitle: "Umgängestvist", organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: LOGO };
    expect(generateFn.mock.calls.map(([a]: [GenArgs]) => [a.recipient, a.meta])).toEqual([
      ["Domstolen betalar", meta],
      ["Cecilia Carlsson", meta],
    ]);
    // Betalarens persisterade nedbrytning (#876) blir dokumentets uppdelning.
    expect(generateFn.mock.calls[0]?.[0]).toMatchObject({ breakdown: BREAKDOWN });
    expect(onClose).toHaveBeenCalled();
  });

  it("utan ärende och inställningar blir fälten tomma — dokumenten skapas ändå", async () => {
    matterData = undefined;
    orgData = undefined;
    render(<SettlementDialog matterId={asId<"MatterId">("m1")} paymentMethod="RATTSSKYDD" onClose={vi.fn()} />);
    await settleOnSuccess?.(RES);
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
  it("visar klientens, betalarens och byråns del med fakturornas netto och brutto", () => {
    splitData = SPLIT;
    render(<SettlementDialog matterId={asId<"MatterId">("m-1")} paymentMethod="RATTSHJALP" onClose={() => {}} />);
    // Momsväxlingen styr om netto eller brutto visas — båda kommer ur samma fördelning.
    const shown = [amountOf("Klientens del"), amountOf("Domstolen betalar"), amountOf("Byrån bär (prutning)")];
    expect([["838,00kr", "3352,00kr", "250,00kr"], ["670,00kr", "2682,00kr", "200,00kr"]]).toContainEqual(shown);
  });

  it("utan nedsättning visas ingen förlustrad", () => {
    splitData = { ...SPLIT, firmLossOre: 0, firmLossGrossOre: 0 };
    render(<SettlementDialog matterId={asId<"MatterId">("m-1")} paymentMethod="RATTSSKYDD" onClose={() => {}} />);
    expect(screen.queryByText("Byrån bär (prutning)")).toBeNull();
    expect(screen.getByText("Försäkringen betalar")).toBeTruthy();
  });
});
