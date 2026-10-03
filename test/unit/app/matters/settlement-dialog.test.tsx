/**
 * SettlementDialog (#852/#1439) — slutregleringen skapar fakturadokument för
 * betalarens och klientens faktura. Båda får ärendets och byråns fält (namn,
 * org.nr och logga ur organisationsinställningarna).
 */

import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { SettlementDialog } from "@/app/matters/[id]/_settlement-dialog";
import { asId } from "@/lib/shared/schemas/ids";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let settleOnSuccess: ((res: unknown) => Promise<void>) | undefined;
let matterData: unknown;
let orgData: unknown;
type GenArgs = { recipient: string; meta: unknown; breakdown?: unknown };
const generateFn = vi.fn(async (_args: GenArgs) => "generated" as const);
const invalidate = vi.fn(async () => {});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ billingRun: { list: { invalidate } }, invoice: { list: { invalidate } } }),
    billingRun: {
      coverageSplit: { useQuery: () => ({ data: undefined }) },
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
