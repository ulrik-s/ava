/**
 * Tester för VerdictDialog (#27/#828 coverage) — offentligt uppdrags sista steg:
 * domstolens beslut är redan registrerat på KR:n, så dialogen bekräftar bara att
 * fakturan ska skapas (inget belopp matas in), visar prutning och genererar ett
 * faktura-dokument onSuccess.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { VerdictDialog } from "@/app/matters/[id]/_verdict-dialog";
import { orgImageSchema } from "@/lib/shared/org-image";
import { asId } from "@/lib/shared/schemas/ids";
import { pdfPageContents, pdfPageTexts } from "../../../helpers/pdf-text";

/** Fakturadokumentet får uuid-id (#1143). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let verdictOnSuccess: ((res: unknown) => Promise<void>) | undefined;
const verdictMutate = vi.fn();
const registerMutateAsync = vi.fn(async () => {});
const specFetch = vi.fn(async () => null);
const persistGeneratedDoc = vi.fn(async () => {});
const treeInvalidate = vi.fn(async () => {});
const treeRefetch = vi.fn(async () => {});
const listInvalidate = vi.fn(async () => {});

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      document: { tree: { invalidate: treeInvalidate, refetch: treeRefetch }, list: { invalidate: listInvalidate } },
      billingRun: { invoiceSpecification: { fetch: specFetch } },
    }),
    document: { register: { useMutation: () => ({ mutateAsync: registerMutateAsync }) } },
    billingRun: {
      setVerdict: {
        useMutation: (opts: { onSuccess: (res: unknown) => Promise<void> }) => {
          verdictOnSuccess = opts.onSuccess;
          return { mutate: verdictMutate, isPending: false, error: null };
        },
      },
    },
  },
}));
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const baseProps = {
  billingRunId: asId<"BillingRunId">("br-1"),
  workValueOre: 500_000,
  awardedOre: 400_000,
  matterId: asId<"MatterId">("m1"),
  matterNumber: "B-2026-1",
  matterTitle: "Brottmål",
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); verdictOnSuccess = undefined; });

describe("VerdictDialog", () => {
  it("visar föreslaget + dömt belopp och prutningen (dömt < föreslaget)", () => {
    render(<VerdictDialog {...baseProps} />);
    expect(screen.getByText("Föreslaget belopp")).toBeInTheDocument();
    expect(screen.getByText("Dömt belopp — inkl. moms")).toBeInTheDocument();
    expect(screen.getByText("Prutning")).toBeInTheDocument();
  });

  it("ingen prutning visas när dömt = föreslaget", () => {
    render(<VerdictDialog {...baseProps} awardedOre={500_000} />);
    expect(screen.queryByText("Prutning")).not.toBeInTheDocument();
  });

  it("submit skapar fakturan utan belopp-input (prutning läses ur KR:ns beslut)", () => {
    render(<VerdictDialog {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(verdictMutate).toHaveBeenCalledWith({ billingRunId: "br-1" });
  });

  it("onSuccess genererar faktura-dokument + registrerar det + stänger", async () => {
    const onClose = vi.fn();
    render(<VerdictDialog {...baseProps} onClose={onClose} />);
    expect(verdictOnSuccess).toBeDefined();
    await verdictOnSuccess!({ invoice: { id: "inv-9", amount: 400_000, invoiceNumber: "2026-9" } });
    // Fakturan renderas via den DELADE vy-modellen (#937) → en PDF (#1439) med
    // sammanställning + specifikation.
    const bytes = persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array;
    const text = (await pdfPageTexts(bytes)).flat();
    expect(text).toContain("Sammanställning");
    expect(text).toContain("Mottagare: Rättshjälpsmyndighet/domstol");
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(UUID_RE), matterId: "m1", invoiceId: "inv-9", documentType: "Faktura",
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("byråns namn, org.nr och logga följer med till fakturadokumentet (#1439)", async () => {
    const logo = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
    render(<VerdictDialog {...baseProps} organization={{ organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: logo }} />);
    await verdictOnSuccess!({ invoice: { id: "inv-9", amount: 400_000, invoiceNumber: "2026-9" } });
    const bytes = persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array;
    expect((await pdfPageTexts(bytes)).flat()).toEqual(expect.arrayContaining(["Byrå AB", "Org.nr 556677-8899"]));
    const [page1] = await pdfPageContents(bytes);
    expect(page1).toMatch(/\/\S+ Do/); // loggan ritad
  });
});
